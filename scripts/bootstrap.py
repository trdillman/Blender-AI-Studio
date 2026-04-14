#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import platform
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def detect_default_blender() -> str | None:
    env_value = os.environ.get("BLENDER_BIN")
    if env_value:
        return env_value
    if platform.system() == "Windows":
        base = Path("C:/Program Files/Blender Foundation")
        if base.exists():
            for child in sorted(base.glob("Blender*"), reverse=True):
                candidate = child / "blender.exe"
                if candidate.exists():
                    return str(candidate)
    return shutil.which("blender")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("local", "cloud"), default="local")
    args = parser.parse_args()
    blender_bin = detect_default_blender()
    remote_gateway = os.environ.get("REMOTE_MCP_GATEWAY_URL", "").strip()

    print(f"Project root: {ROOT}")
    print(f"Bootstrap mode: {args.mode}")
    print(f"Platform: {platform.system()} {platform.release()}")
    print(f"Blender detected: {'yes' if blender_bin else 'no'}")
    if blender_bin:
        print(f"BLENDER_BIN={blender_bin}")
    print(f"Remote MCP bridge configured: {'yes' if remote_gateway else 'no'}")
    if args.mode == "cloud":
        print("Cloud mode keeps Blender work headless-safe.")
    else:
        print("Local mode is suitable for Blender GUI validation.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
