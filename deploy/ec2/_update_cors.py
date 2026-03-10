#!/usr/bin/env python3
"""Update RUNNER_ALLOWED_ORIGIN on remote EC2 and restart runner.

Defaults are loaded from deploy/ec2/.state, with env/CLI overrides.
"""

from __future__ import annotations

import argparse
import os
import re
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


def main() -> int:
  state = parse_state(STATE_PATH)

  parser = argparse.ArgumentParser(description="Update RUNNER_ALLOWED_ORIGIN on EC2 runner .env")
  parser.add_argument("--host", default=os.environ.get("EC2_HOST") or state.get("EC2_HOST"))
  parser.add_argument("--user", default=os.environ.get("EC2_USER") or state.get("EC2_USER") or "ubuntu")
  parser.add_argument("--key", default=os.environ.get("EC2_KEY") or state.get("EC2_KEY") or "~/.ssh/dsa-runner.pem")
  parser.add_argument("--runner-env-path", default="/opt/dsa-runner/.env")
  parser.add_argument("--runner-dir", default="/opt/dsa-runner")
  parser.add_argument("--health-url", default="https://runner.czarflix.me/healthz")
  parser.add_argument(
    "--origins",
    default=os.environ.get(
      "RUNNER_ALLOWED_ORIGIN",
      "https://czarflix.me,https://runner.czarflix.me,http://localhost:5173,http://localhost:4173",
    ),
  )
  parser.add_argument("--allow-wildcard", action="store_true")
  args = parser.parse_args()

  try:
    host = ensure_value("EC2_HOST", args.host)
    key = os.path.expanduser(ensure_value("EC2_KEY", args.key))
    origins = ensure_value("RUNNER_ALLOWED_ORIGIN", args.origins)
  except ValueError as error:
    print(f"ERROR: {error}", file=sys.stderr)
    return 1

  normalized_origins = ",".join(
    sorted({item.strip().rstrip("/") for item in origins.split(",") if item.strip()})
  )
  if "*" in normalized_origins and not args.allow_wildcard:
    print("ERROR: wildcard '*' is blocked by default. Use --allow-wildcard to override.", file=sys.stderr)
    return 1

  ssh = ["ssh", "-i", key, "-o", "StrictHostKeyChecking=accept-new", f"{args.user}@{host}"]
  scp = ["scp", "-i", key, "-o", "StrictHostKeyChecking=accept-new"]

  try:
    current_env = run(ssh + ["cat", args.runner_env_path])
  except Exception as error:  # pylint: disable=broad-except
    print(f"ERROR reading remote env: {error}", file=sys.stderr)
    return 1

  if re.search(r"^RUNNER_ALLOWED_ORIGIN=.*$", current_env, flags=re.MULTILINE):
    updated_env = re.sub(
      r"^RUNNER_ALLOWED_ORIGIN=.*$",
      f"RUNNER_ALLOWED_ORIGIN={normalized_origins}",
      current_env,
      flags=re.MULTILINE,
    )
  else:
    updated_env = current_env.rstrip() + f"\nRUNNER_ALLOWED_ORIGIN={normalized_origins}\n"

  local_tmp = "/tmp/_dsa_runner_env"
  Path(local_tmp).write_text(updated_env, encoding="utf-8")

  try:
    run(scp + [local_tmp, f"{args.user}@{host}:/tmp/_runner_env"])
    run(ssh + ["cp", "/tmp/_runner_env", args.runner_env_path])
    run(ssh + [f"cd {args.runner_dir} && docker compose up -d --force-recreate"])
  except Exception as error:  # pylint: disable=broad-except
    print(f"ERROR updating remote env/restart: {error}", file=sys.stderr)
    return 1
  finally:
    try:
      os.remove(local_tmp)
    except OSError:
      pass

  print(f"Updated RUNNER_ALLOWED_ORIGIN to: {normalized_origins}")

  if args.health_url:
    try:
      health = run(["curl", "-sS", "-i", "--max-time", "12", args.health_url])
      header_lines = [line for line in health.splitlines() if line.lower().startswith("access-control-allow-origin")]
      print("Health endpoint reachable.")
      if header_lines:
        print("CORS header(s):")
        for line in header_lines:
          print(f"  {line}")
    except Exception as error:  # pylint: disable=broad-except
      print(f"WARNING: health check failed after update: {error}", file=sys.stderr)

  return 0


if __name__ == "__main__":
  raise SystemExit(main())
