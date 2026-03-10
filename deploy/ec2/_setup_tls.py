#!/usr/bin/env python3
"""Install nginx + certbot and configure TLS for runner domain on EC2."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
STATE_PATH = SCRIPT_DIR / ".state"


def parse_state(path: Path) -> dict[str, str]:
  if not path.exists():
    return {}

  values: dict[str, str] = {}
  for raw_line in path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip()
  return values


def run(command: list[str]) -> str:
  result = subprocess.run(command, capture_output=True, text=True)
  if result.returncode != 0:
    message = result.stderr.strip() or result.stdout.strip() or "Unknown failure"
    raise RuntimeError(f"Command failed: {' '.join(command)}\n{message}")
  return result.stdout


def ensure_value(name: str, value: str | None) -> str:
  cleaned = (value or "").strip()
  if not cleaned:
    raise ValueError(f"Missing required value: {name}")
  return cleaned


def build_nginx_http_conf(domain: str, upstream: str) -> str:
  return "\n".join(
    [
      "server {",
      "    listen 80;",
      f"    server_name {domain};",
      "",
      "    location / {",
      f"        proxy_pass         http://{upstream};",
      "        proxy_http_version 1.1;",
      "        proxy_set_header   Host              $host;",
      "        proxy_set_header   X-Real-IP         $remote_addr;",
      "        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;",
      "        proxy_set_header   X-Forwarded-Proto $scheme;",
      "        proxy_read_timeout 60s;",
      "        proxy_buffering    off;",
      "    }",
      "}",
      "",
    ]
  )


def main() -> int:
  state = parse_state(STATE_PATH)

  parser = argparse.ArgumentParser(description="Setup nginx and Let's Encrypt for runner service")
  parser.add_argument("--host", default=os.environ.get("EC2_HOST") or state.get("EC2_HOST"))
  parser.add_argument("--user", default=os.environ.get("EC2_USER") or state.get("EC2_USER") or "ubuntu")
  parser.add_argument("--key", default=os.environ.get("EC2_KEY") or state.get("EC2_KEY") or "~/.ssh/dsa-runner.pem")
  parser.add_argument("--domain", default=os.environ.get("RUNNER_DOMAIN") or "runner.czarflix.me")
  parser.add_argument("--email", default=os.environ.get("LETSENCRYPT_EMAIL") or "admin@czarflix.me")
  parser.add_argument("--upstream", default=os.environ.get("RUNNER_UPSTREAM") or "127.0.0.1:8787")
  parser.add_argument("--site-name", default="runner")
  args = parser.parse_args()

  try:
    host = ensure_value("EC2_HOST", args.host)
    key = os.path.expanduser(ensure_value("EC2_KEY", args.key))
    domain = ensure_value("RUNNER_DOMAIN", args.domain)
    email = ensure_value("LETSENCRYPT_EMAIL", args.email)
  except ValueError as error:
    print(f"ERROR: {error}", file=sys.stderr)
    return 1

  nginx_conf = build_nginx_http_conf(domain, args.upstream.strip())
  local_tmp = "/tmp/_dsa_nginx.conf"
  Path(local_tmp).write_text(nginx_conf, encoding="utf-8")

  ssh = ["ssh", "-i", key, "-o", "StrictHostKeyChecking=accept-new", f"{args.user}@{host}"]
  scp = ["scp", "-i", key, "-o", "StrictHostKeyChecking=accept-new"]

  remote_tmp = f"/tmp/{args.site_name}.nginx"
  remote_site = f"/etc/nginx/sites-available/{args.site_name}"
  remote_link = f"/etc/nginx/sites-enabled/{args.site_name}"

  try:
    run(scp + [local_tmp, f"{args.user}@{host}:{remote_tmp}"])
    run(ssh + ["sudo", "apt-get", "update", "-y"])
    run(ssh + ["sudo", "apt-get", "install", "-y", "nginx", "python3-certbot-nginx"])
    run(ssh + ["sudo", "cp", remote_tmp, remote_site])
    run(ssh + ["sudo", "ln", "-sf", remote_site, remote_link])
    run(ssh + ["sudo", "rm", "-f", "/etc/nginx/sites-enabled/default"])
    run(ssh + ["sudo", "nginx", "-t"])
    run(ssh + ["sudo", "systemctl", "reload", "nginx"])

    run(
      ssh
      + [
        "sudo",
        "certbot",
        "--nginx",
        "--non-interactive",
        "--agree-tos",
        "--email",
        email,
        "--redirect",
        "-d",
        domain,
      ]
    )
  except Exception as error:  # pylint: disable=broad-except
    print(f"ERROR: {error}", file=sys.stderr)
    return 1
  finally:
    try:
      os.remove(local_tmp)
    except OSError:
      pass

  try:
    health = run(["curl", "-sS", "-i", "--max-time", "12", f"https://{domain}/healthz"])
    print(health.splitlines()[0] if health else "No response")
  except Exception as error:  # pylint: disable=broad-except
    print(f"WARNING: Post-TLS health check failed: {error}", file=sys.stderr)

  print("TLS setup completed.")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
