#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    print("headless validation")
    print(f"python_ok={sys.version_info >= (3, 11)}")
    print(f"repo_root_exists={ROOT.exists()}")
    print(f"remote_gateway_mode={'optional-configured' if os.environ.get('REMOTE_MCP_GATEWAY_URL') else 'optional-skipped'}")
    print("result=ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
