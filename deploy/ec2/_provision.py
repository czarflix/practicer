#!/usr/bin/env python3
"""Provision EC2 instance for DSA runner deployment.

Creates/reuses:
- key pair
- default-VPC security group
- Ubuntu 22.04 instance
- Elastic IP association

Writes deploy/ec2/.state for follow-up scripts.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
STATE_PATH = SCRIPT_DIR / ".state"


def run_aws(region: str, *args: str) -> dict:
  command = ["aws", "--region", region, *args, "--output", "json"]
  result = subprocess.run(command, capture_output=True, text=True)
  if result.returncode != 0:
    message = result.stderr.strip() or result.stdout.strip() or "Unknown AWS CLI error"
    raise RuntimeError(f"AWS command failed: {' '.join(command)}\n{message}")
  text = result.stdout.strip()
  return json.loads(text) if text else {}


def try_aws(region: str, *args: str) -> tuple[bool, dict, str]:
  command = ["aws", "--region", region, *args, "--output", "json"]
  result = subprocess.run(command, capture_output=True, text=True)
  if result.returncode != 0:
    message = result.stderr.strip() or result.stdout.strip() or "Unknown AWS CLI error"
    return False, {}, message
  text = result.stdout.strip()
  return True, (json.loads(text) if text else {}), ""


def ensure_key_pair(region: str, key_name: str, key_path: Path) -> None:
  ok, _, _ = try_aws(region, "ec2", "describe-key-pairs", "--key-names", key_name)
  if ok:
    if not key_path.exists():
      print(f"WARNING: key pair '{key_name}' exists in AWS but local key file is missing: {key_path}")
    else:
      print(f"Key pair exists: {key_name}")
    return

  print(f"Creating key pair: {key_name}")
  response = run_aws(region, "ec2", "create-key-pair", "--key-name", key_name)
  key_material = response.get("KeyMaterial", "")
  if not key_material:
    raise RuntimeError("AWS did not return KeyMaterial for new key pair.")

  key_path.parent.mkdir(parents=True, exist_ok=True)
  key_path.write_text(key_material, encoding="utf-8")
  os.chmod(key_path, 0o400)
  print(f"Saved private key: {key_path}")


def get_default_vpc(region: str) -> str:
  response = run_aws(region, "ec2", "describe-vpcs", "--filters", "Name=isDefault,Values=true")
  vpcs = response.get("Vpcs", [])
  if not vpcs:
    raise RuntimeError("No default VPC found. Create one or pass a VPC manually.")
  return str(vpcs[0]["VpcId"])


def ensure_security_group(region: str, sg_name: str, vpc_id: str) -> str:
  ok, response, _ = try_aws(
    region,
    "ec2",
    "describe-security-groups",
    "--filters",
    f"Name=group-name,Values={sg_name}",
    f"Name=vpc-id,Values={vpc_id}",
  )
  if ok and response.get("SecurityGroups"):
    sg_id = str(response["SecurityGroups"][0]["GroupId"])
    print(f"Security group exists: {sg_name} ({sg_id})")
    return sg_id

  print(f"Creating security group: {sg_name}")
  created = run_aws(
    region,
    "ec2",
    "create-security-group",
    "--group-name",
    sg_name,
    "--description",
    "DSA runner security group",
    "--vpc-id",
    vpc_id,
  )
  sg_id = str(created["GroupId"])
  print(f"Created SG: {sg_id}")
  return sg_id


def authorize_ingress_if_needed(region: str, sg_id: str, port: int, cidr: str) -> None:
  ok, _, message = try_aws(
    region,
    "ec2",
    "authorize-security-group-ingress",
    "--group-id",
    sg_id,
    "--protocol",
    "tcp",
    "--port",
    str(port),
    "--cidr",
    cidr,
  )
  if ok:
    print(f"Ingress allowed: tcp/{port} from {cidr}")
    return
  if "InvalidPermission.Duplicate" in message:
    print(f"Ingress already present: tcp/{port} from {cidr}")
    return
  raise RuntimeError(f"Failed to authorize ingress for port {port}: {message}")


def latest_ubuntu_ami(region: str) -> tuple[str, str]:
  response = run_aws(
    region,
    "ec2",
    "describe-images",
    "--owners",
    "099720109477",
    "--filters",
    "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*",
    "Name=architecture,Values=x86_64",
    "Name=state,Values=available",
  )
  images = sorted(response.get("Images", []), key=lambda item: item["CreationDate"], reverse=True)
  if not images:
    raise RuntimeError("No Ubuntu 22.04 AMI found.")
  return str(images[0]["ImageId"]), str(images[0]["Name"])


def wait_instance_running(region: str, instance_id: str, timeout_seconds: int = 300) -> None:
  elapsed = 0
  while elapsed < timeout_seconds:
    info = run_aws(region, "ec2", "describe-instances", "--instance-ids", instance_id)
    state = str(info["Reservations"][0]["Instances"][0]["State"]["Name"])
    print(f"[{elapsed:>3}s] instance state: {state}")
    if state == "running":
      return
    time.sleep(5)
    elapsed += 5
  raise RuntimeError("Instance did not enter running state before timeout.")


def write_state_file(
  host: str,
  key_path: Path,
  user: str,
  instance_id: str,
  allocation_id: str,
  region: str,
  sg_id: str,
) -> None:
  lines = [
    f"EC2_HOST={host}",
    f"EC2_KEY={key_path}",
    f"EC2_USER={user}",
    f"INSTANCE_ID={instance_id}",
    f"ELASTIC_IP={host}",
    f"ALLOCATION_ID={allocation_id}",
    f"REGION={region}",
    f"SG_ID={sg_id}",
  ]
  STATE_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
  parser = argparse.ArgumentParser(description="Provision EC2 infrastructure for DSA runner")
  parser.add_argument("--region", default="ap-south-1")
  parser.add_argument("--key-name", default="dsa-runner")
  parser.add_argument("--key-path", default="~/.ssh/dsa-runner.pem")
  parser.add_argument("--security-group-name", default="dsa-runner-sg")
  parser.add_argument("--instance-type", default="t3.medium")
  parser.add_argument("--volume-size-gb", type=int, default=30)
  parser.add_argument("--ssh-cidr", default="0.0.0.0/0")
  parser.add_argument("--name-tag", default="dsa-runner")
  args = parser.parse_args()

  region = args.region.strip()
  key_name = args.key_name.strip()
  key_path = Path(os.path.expanduser(args.key_path)).resolve()

  try:
    print(f"Region: {region}")
    ensure_key_pair(region, key_name, key_path)

    vpc_id = get_default_vpc(region)
    print(f"Default VPC: {vpc_id}")

    sg_id = ensure_security_group(region, args.security_group_name.strip(), vpc_id)
    authorize_ingress_if_needed(region, sg_id, 22, args.ssh_cidr.strip())
    authorize_ingress_if_needed(region, sg_id, 80, "0.0.0.0/0")
    authorize_ingress_if_needed(region, sg_id, 443, "0.0.0.0/0")

    ami_id, ami_name = latest_ubuntu_ami(region)
    print(f"AMI: {ami_id} ({ami_name})")

    print("Launching instance...")
    launch = run_aws(
      region,
      "ec2",
      "run-instances",
      "--image-id",
      ami_id,
      "--instance-type",
      args.instance_type.strip(),
      "--key-name",
      key_name,
      "--security-group-ids",
      sg_id,
      "--block-device-mappings",
      json.dumps(
        [
          {
            "DeviceName": "/dev/sda1",
            "Ebs": {
              "VolumeSize": args.volume_size_gb,
              "VolumeType": "gp3",
              "DeleteOnTermination": True,
            },
          }
        ]
      ),
      "--tag-specifications",
      json.dumps(
        [
          {
            "ResourceType": "instance",
            "Tags": [
              {"Key": "Name", "Value": args.name_tag.strip()},
              {"Key": "Project", "Value": "dsa-tracker"},
            ],
          }
        ]
      ),
      "--count",
      "1",
    )
    instance_id = str(launch["Instances"][0]["InstanceId"])
    print(f"Instance ID: {instance_id}")

    print("Waiting for instance...")
    wait_instance_running(region, instance_id)

    print("Allocating Elastic IP...")
    eip = run_aws(region, "ec2", "allocate-address", "--domain", "vpc")
    allocation_id = str(eip["AllocationId"])
    public_ip = str(eip["PublicIp"])
    run_aws(region, "ec2", "associate-address", "--instance-id", instance_id, "--allocation-id", allocation_id)
    print(f"Elastic IP associated: {public_ip} ({allocation_id})")

    write_state_file(public_ip, key_path, "ubuntu", instance_id, allocation_id, region, sg_id)

    print("\nProvisioning complete.")
    print(f"  instance_id: {instance_id}")
    print(f"  host:        {public_ip}")
    print(f"  key:         {key_path}")
    print(f"  sg_id:       {sg_id}")
    print(f"  state file:  {STATE_PATH}")
    print("\nNext:")
    print("  1) ./deploy/ec2/sync-to-ec2.sh")
    print("  2) ssh in and run /opt/dsa-deploy/ec2/phase1-install.sh")
    return 0
  except Exception as error:  # pylint: disable=broad-except
    print(f"ERROR: {error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
  raise SystemExit(main())
