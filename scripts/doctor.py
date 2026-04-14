#!/usr/bin/env python3
from __future__ import annotations

import os
import platform
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    print("codex doctor")
    print(f"project_root={ROOT}")
    print(f"python={platform.python_version()}")
    print(f"platform={platform.system()} {platform.release()}")
    print(f"git={'yes' if shutil.which('git') else 'no'}")
    print(f"gh={'yes' if shutil.which('gh') else 'no'}")
    print(f"blender={'yes' if (os.environ.get('BLENDER_BIN') or shutil.which('blender')) else 'no'}")
    print(f"remote_mcp_gateway={'configured' if os.environ.get('REMOTE_MCP_GATEWAY_URL') else 'not-configured'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
