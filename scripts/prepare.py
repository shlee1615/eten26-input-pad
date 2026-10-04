#!/usr/bin/env python3
"""Fetch pinned public engine/fonts; never reads local user settings."""
from pathlib import Path
import hashlib
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
ENGINE_COMMIT = "e7bfa5547b92e08265bff2b23ecf0ada832d9270"
FONT_COMMIT = "7aa40842e4c9dc67f453603c3a4107a309c46587"
FONTS = {
    "BpmfZihiKaiStd-Regular.woff2": "5e409df1c22fc0ef60a6ac019267aed6cf27a72a75a43555a25312f9bb8383ee",
    "BpmfZihiSans-Regular.woff2": "fea9badb2e4ce64ada0116d2b373176884d3819e7bfc5c7f2551a4b43ad4970b",
    "BpmfZihiSerif-Regular.woff2": "8d0221f3b65a6d8f5d4fa08d0b1ce59ab6d99e4460cb4b937bd9abae81719f71",
    "ToneOZ-Pinyin-Kai-Traditional.woff2": "4834e5b7dba54a4781160206e9f4054e0b78f4dbf32fe9cc576d40aef3317690",
}

def run(*args, cwd):
    subprocess.run(args, cwd=cwd, check=True)

def main():
    for name, expected in FONTS.items():
        dest = ROOT / "input-pad" / "fonts" / name
        if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == expected:
            continue
        url = f"https://raw.githubusercontent.com/oikasu1/fonts/{FONT_COMMIT}/{name}"
        print("Downloading", name, flush=True)
        with urllib.request.urlopen(url, timeout=120) as response:
            content = response.read()
        if hashlib.sha256(content).hexdigest() != expected:
            raise RuntimeError(f"Font checksum mismatch: {name}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)

    upstream = ROOT / "vendor" / "McBopomofoWeb"
    required = [upstream / "src/McBopomofo/InputController.ts", upstream / "package.json", upstream / "output/example/bundle.js", upstream / "output/example/bundle.js.LICENSE.txt", upstream / "LICENSE.txt"]
    required += [upstream / "node_modules" / name / "LICENSE" for name in ("chinese_convert", "dayjs", "lodash", "lunar-typescript", "lz-string")]
    patch = ROOT / "patches" / "engine-state-kind.patch"
    patched = (upstream / "src/McBopomofo/InputController.ts").is_file() and "public getStateKind(): string" in (upstream / "src/McBopomofo/InputController.ts").read_text()
    if all(path.is_file() for path in required) and patched:
        print("Bundled engine and licenses present; ready to build.")
        return
    upstream.parent.mkdir(parents=True, exist_ok=True)
    if not (upstream / ".git").exists():
        if upstream.exists() and any(upstream.iterdir()):
            raise RuntimeError("Incomplete vendor directory; move it aside before fetching the engine.")
        upstream.mkdir(exist_ok=True)
        run("git", "init", cwd=upstream)
        run("git", "remote", "add", "origin", "https://github.com/openvanilla/McBopomofoWeb.git", cwd=upstream)
    run("git", "fetch", "--depth=1", "origin", ENGINE_COMMIT, cwd=upstream)
    run("git", "checkout", "--detach", ENGINE_COMMIT, cwd=upstream)
    reverse = subprocess.run(["git", "apply", "--reverse", "--check", str(patch)], cwd=upstream, capture_output=True)
    if reverse.returncode != 0:
        run("git", "apply", "--check", str(patch), cwd=upstream)
        run("git", "apply", str(patch), cwd=upstream)
    run("npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund", cwd=upstream)
    run("npm", "run", "build", cwd=upstream)
    print("Pinned dependencies ready.")

if __name__ == "__main__":
    main()
