#!/usr/bin/env python3
from __future__ import annotations

import os
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ADDON_DIR = ROOT / "addon"
DIST_DIR = ROOT / "dist"


def main() -> int:
    addon_name = os.environ.get("BLENDER_ADDON_NAME", "codex_addon").strip() or "codex_addon"
    DIST_DIR.mkdir(exist_ok=True)
    zip_path = DIST_DIR / f"{addon_name}.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        if ADDON_DIR.exists():
            for path in ADDON_DIR.rglob("*"):
                if path.is_file():
                    archive.write(path, path.relative_to(ROOT))
        else:
            archive.writestr("README.txt", "Add Blender add-on files under addon/.")
    print(f"created={zip_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
