#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN_DIR="$PROJECT_DIR/.toolchain"
SYSROOT="$TOOLCHAIN_DIR/sysroot"

export RUSTUP_HOME="$TOOLCHAIN_DIR/rustup"
export CARGO_HOME="$TOOLCHAIN_DIR/cargo"
export CARGO_NET_OFFLINE=true
export CARGO_NET_RETRY=1
export XWIN_CACHE_DIR="$TOOLCHAIN_DIR/xwin-cache"
export PATH="$CARGO_HOME/bin:$SYSROOT/usr/bin:$PATH"
export LD_LIBRARY_PATH="$SYSROOT/usr/lib:/usr/lib:${LD_LIBRARY_PATH:-}"

cd "$PROJECT_DIR"
echo "=== Cross-Compiling Windows x64 Executable (Tauri v2 + cargo-xwin) ==="
./node_modules/.bin/tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle

mkdir -p "$PROJECT_DIR/release/windows"
cp -f "$PROJECT_DIR/src-tauri/target/x86_64-pc-windows-msvc/release/multiplayer-cylinder.exe" "$PROJECT_DIR/release/windows/"
if [ -f "$PROJECT_DIR/src-tauri/target/x86_64-pc-windows-msvc/release/WebView2Loader.dll" ]; then
  cp -f "$PROJECT_DIR/src-tauri/target/x86_64-pc-windows-msvc/release/WebView2Loader.dll" "$PROJECT_DIR/release/windows/"
fi

echo "=== Windows build complete! Outputs in release/windows/ and src-tauri/target/x86_64-pc-windows-msvc/release/ ==="
ls -lh "$PROJECT_DIR/release/windows/"

