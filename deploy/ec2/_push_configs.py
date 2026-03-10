#!/usr/bin/env python3
"""Safely generate and upload judge0.conf and runner .env to EC2.

This script never stores real secrets in source control. Supply all secrets via:
- command-line flags, or
- environment variables.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
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


def require_value(name: str, value: str | None) -> str:
  cleaned = (value or "").strip()
  if not cleaned:
    raise ValueError(f"Missing required value: {name}")
  return cleaned


def run(command: list[str]) -> None:
  result = subprocess.run(command, capture_output=True, text=True)
  if result.returncode != 0:
    message = result.stderr.strip() or result.stdout.strip() or "Unknown failure"
    raise RuntimeError(f"Command failed: {' '.join(command)}\n{message}")


def scp_text(content: str, remote_path: str, host: str, user: str, key_path: str) -> None:
  with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8") as tmp:
    tmp.write(content)
    local_path = tmp.name

  try:
    run(
      [
        "scp",
        "-i",
        key_path,
        "-o",
        "StrictHostKeyChecking=accept-new",
        local_path,
        f"{user}@{host}:{remote_path}",
      ]
    )
  finally:
    try:
      os.remove(local_path)
    except OSError:
      pass


def build_judge0_conf(postgres_password: str, redis_password: str, authn_token: str) -> str:
  lines = [
    "POSTGRES_HOST=db",
    "POSTGRES_DB=judge0",
    "POSTGRES_USER=judge0",
    f"POSTGRES_PASSWORD={postgres_password}",
    "",
    "REDIS_HOST=redis",
    f"REDIS_PASSWORD={redis_password}",
    "",
    "AUTHN_HEADER=X-Auth-Token",
    f"AUTHN_TOKEN={authn_token}",
    "",
    "CPU_TIME_LIMIT=5",
    "CPU_EXTRA_TIME=1",
    "WALL_TIME_LIMIT=10",
    "MEMORY_LIMIT=262144",
    "STACK_LIMIT=65536",
    "MAX_FILE_SIZE=1024",
    "NUMBER_OF_RUNS=1",
    "RAILS_MAX_THREADS=4",
    "",
  ]
  return "\n".join(lines)


def build_runner_env(
  allowed_origins: str,
  supabase_url: str,
  service_role_key: str,
  judge0_url: str,
  judge0_api_key: str,
) -> str:
  lines = [
    "RUNNER_PORT=8787",
    f"RUNNER_ALLOWED_ORIGIN={allowed_origins}",
    f"SUPABASE_URL={supabase_url}",
    f"SUPABASE_SERVICE_ROLE_KEY={service_role_key}",
    f"JUDGE0_URL={judge0_url}",
    f"JUDGE0_API_KEY={judge0_api_key}",
    "RUNNER_MAX_TESTS=150",
    "RUNNER_MAX_CODE_CHARS=200000",
    "RUNNER_TIME_LIMIT=5",
    "RUNNER_WALL_TIME_LIMIT=10",
    "RUNNER_MEMORY_LIMIT_KB=262144",
    "",
  ]
  return "\n".join(lines)


def main() -> int:
  state = parse_state(STATE_PATH)

  parser = argparse.ArgumentParser(description="Upload judge0.conf and runner .env to EC2")
  parser.add_argument("--host", default=os.environ.get("EC2_HOST") or state.get("EC2_HOST"), help="EC2 host/IP")
  parser.add_argument("--user", default=os.environ.get("EC2_USER") or state.get("EC2_USER") or "ubuntu")
  parser.add_argument(
    "--key",
    default=os.environ.get("EC2_KEY") or state.get("EC2_KEY") or "~/.ssh/dsa-runner.pem",
    help="Path to SSH private key",
  )

  parser.add_argument("--judge0-postgres-password", default=os.environ.get("JUDGE0_POSTGRES_PASSWORD"))
  parser.add_argument("--judge0-redis-password", default=os.environ.get("JUDGE0_REDIS_PASSWORD"))
  parser.add_argument("--judge0-authn-token", default=os.environ.get("JUDGE0_AUTHN_TOKEN", ""))

  parser.add_argument("--supabase-url", default=os.environ.get("SUPABASE_URL"))
  parser.add_argument("--supabase-service-role-key", default=os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))
  parser.add_argument(
    "--runner-allowed-origins",
    default=os.environ.get(
      "RUNNER_ALLOWED_ORIGIN",
      "https://czarflix.me,https://runner.czarflix.me,http://localhost:5173,http://localhost:4173",
    ),
  )
  parser.add_argument("--judge0-url", default=os.environ.get("JUDGE0_URL", "http://host.docker.internal:2358"))
  parser.add_argument("--judge0-api-key", default=os.environ.get("JUDGE0_API_KEY", ""))

  parser.add_argument("--judge0-conf-path", default="/opt/judge0/judge0.conf")
  parser.add_argument("--runner-env-path", default="/opt/dsa-runner/.env")
  parser.add_argument("--print-only", action="store_true", help="Print redacted summary without uploading")

  args = parser.parse_args()

  try:
    host = require_value("EC2_HOST", args.host)
    key_path = os.path.expanduser(require_value("EC2_KEY", args.key))
    postgres_password = require_value("JUDGE0_POSTGRES_PASSWORD", args.judge0_postgres_password)
    redis_password = require_value("JUDGE0_REDIS_PASSWORD", args.judge0_redis_password)
    supabase_url = require_value("SUPABASE_URL", args.supabase_url)
    service_role_key = require_value("SUPABASE_SERVICE_ROLE_KEY", args.supabase_service_role_key)
    allowed_origins = require_value("RUNNER_ALLOWED_ORIGIN", args.runner_allowed_origins)
  except ValueError as error:
    print(f"ERROR: {error}", file=sys.stderr)
    print(
      "Hint: set required values via env vars or flags:\n"
      "  JUDGE0_POSTGRES_PASSWORD, JUDGE0_REDIS_PASSWORD,\n"
      "  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,\n"
      "  EC2_HOST/EC2_KEY",
      file=sys.stderr,
    )
    return 1

  if "*" in {origin.strip() for origin in allowed_origins.split(",")}:
    print("ERROR: RUNNER_ALLOWED_ORIGIN cannot include '*' in production config pushes.", file=sys.stderr)
    return 1

  judge0_conf = build_judge0_conf(postgres_password, redis_password, args.judge0_authn_token)
  runner_env = build_runner_env(
    allowed_origins,
    supabase_url,
    service_role_key,
    args.judge0_url.strip(),
    args.judge0_api_key.strip(),
  )

  if args.print_only:
    print("Dry summary:")
    print(f"  host={host}")
    print(f"  user={args.user}")
    print(f"  key={key_path}")
    print(f"  judge0_conf_path={args.judge0_conf_path}")
    print(f"  runner_env_path={args.runner_env_path}")
    print(f"  runner_allowed_origins={allowed_origins}")
    print("  supabase_service_role_key=<provided>")
    return 0

  try:
    scp_text(judge0_conf, args.judge0_conf_path, host, args.user, key_path)
    scp_text(runner_env, args.runner_env_path, host, args.user, key_path)
  except Exception as error:  # pylint: disable=broad-except
    print(f"ERROR: {error}", file=sys.stderr)
    return 1

  print(f"Uploaded judge0.conf -> {args.judge0_conf_path}")
  print(f"Uploaded runner .env -> {args.runner_env_path}")
  print("Next: ssh in and restart stacks:")
  print("  cd /opt/judge0 && docker compose up -d")
  print("  cd /opt/dsa-runner && docker compose up -d --force-recreate")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
