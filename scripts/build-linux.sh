#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLCHAIN_DIR="$PROJECT_DIR/.toolchain"
SYSROOT="$TOOLCHAIN_DIR/sysroot"

export RUSTUP_HOME="$TOOLCHAIN_DIR/rustup"
export CARGO_HOME="$TOOLCHAIN_DIR/cargo"
export CARGO_NET_OFFLINE=true
export PATH="$CARGO_HOME/bin:$SYSROOT/usr/bin:$PATH"
export LD_LIBRARY_PATH="$SYSROOT/usr/lib:/usr/lib:${LD_LIBRARY_PATH:-}"
export LIBRARY_PATH="$SYSROOT/usr/lib:/usr/lib:${LIBRARY_PATH:-}"
export PKG_CONFIG_PATH="$SYSROOT/usr/lib/pkgconfig:/usr/lib/pkgconfig:/usr/share/pkgconfig:${PKG_CONFIG_PATH:-}"
export RUSTFLAGS="-L native=$SYSROOT/usr/lib -C link-arg=-Wl,-rpath,$SYSROOT/usr/lib -C link-arg=-Wl,-rpath-link,$SYSROOT/usr/lib"

cd "$PROJECT_DIR"
echo "=== Building Linux Native Binary & Packages (Tauri v2) ==="
./node_modules/.bin/tauri build --bundles deb,rpm

mkdir -p "$PROJECT_DIR/release/linux"
cp -f "$PROJECT_DIR/src-tauri/target/release/multiplayer-cylinder" "$PROJECT_DIR/release/linux/"
cp -f "$PROJECT_DIR/src-tauri/target/release/bundle/deb/"*.deb "$PROJECT_DIR/release/linux/" 2>/dev/null || true
cp -f "$PROJECT_DIR/src-tauri/target/release/bundle/rpm/"*.rpm "$PROJECT_DIR/release/linux/" 2>/dev/null || true

echo "=== Linux build complete! Outputs in release/linux/ and src-tauri/target/release/ ==="
ls -lh "$PROJECT_DIR/release/linux/"

