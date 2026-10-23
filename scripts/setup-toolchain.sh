#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/turab/Projects/multiplayer-cylinder"
TOOLCHAIN_DIR="$PROJECT_DIR/.toolchain"
SYSROOT="$TOOLCHAIN_DIR/sysroot"
PKG_CACHE="$TOOLCHAIN_DIR/pkg-cache"
export RUSTUP_HOME="$TOOLCHAIN_DIR/rustup"
export CARGO_HOME="$TOOLCHAIN_DIR/cargo"

mkdir -p "$SYSROOT" "$PKG_CACHE" "$RUSTUP_HOME" "$CARGO_HOME/bin"

MIRRORS=(
  "https://frankfurt.mirror.pkgbuild.com/extra/os/x86_64"
  "https://singapore.mirror.pkgbuild.com/extra/os/x86_64"
  "https://geo.mirror.pkgbuild.com/extra/os/x86_64"
)

PKGS=(
  "harfbuzz-icu-14.6.0-1-x86_64.pkg.tar.zst"
  "hyphen-2.8.9-1-x86_64.pkg.tar.zst"
  "libmanette-0.2.13-2-x86_64.pkg.tar.zst"
  "woff2-1.0.2-7-x86_64.pkg.tar.zst"
  "xdg-dbus-proxy-0.1.9-1-x86_64.pkg.tar.zst"
  "webkit2gtk-4.1-2.54.1-1-x86_64.pkg.tar.zst"
  "clang-libs-23.1.3-4-x86_64.pkg.tar.zst"
  "llvm-23.1.3-4-x86_64.pkg.tar.zst"
  "compiler-rt-23.1.3-4-x86_64.pkg.tar.zst"
  "clang-23.1.3-4-x86_64.pkg.tar.zst"
  "patchelf-0.19.2-1-x86_64.pkg.tar.zst"
  "rustup-1.29.2-1-x86_64.pkg.tar.zst"
)

echo "=== 1. Downloading and extracting system libraries & LLVM/Clang ==="
for filename in "${PKGS[@]}"; do
  dest="$PKG_CACHE/$filename"
  if [ ! -f "$dest" ]; then
    echo "Downloading $filename..."
    downloaded=0
    for mirror in "${MIRRORS[@]}"; do
      if curl -fL --connect-timeout 8 --max-time 180 -o "$dest.tmp" "$mirror/$filename"; then
        mv "$dest.tmp" "$dest"
        downloaded=1
        break
      fi
    done
    if [ "$downloaded" -eq 0 ]; then
      echo "Failed to download $filename from all mirrors" >&2
      exit 1
    fi
  fi
  tar --zstd -xf "$dest" -C "$SYSROOT" usr/
done

# Fix pkg-config prefix paths in local sysroot
if [ -d "$SYSROOT/usr/lib/pkgconfig" ]; then
  sed -i "s|^prefix=/usr$|prefix=$SYSROOT/usr|g" "$SYSROOT/usr/lib/pkgconfig/"*.pc
fi

export PATH="$CARGO_HOME/bin:$SYSROOT/usr/bin:$PATH"
export LD_LIBRARY_PATH="$SYSROOT/usr/lib:${LD_LIBRARY_PATH:-}"

echo "=== 2. Installing Rust stable toolchain and Windows target ==="
for tool in rustc cargo rustdoc rustfmt cargo-fmt cargo-clippy clippy-driver; do
  ln -sf "$SYSROOT/usr/bin/rustup" "$CARGO_HOME/bin/$tool"
done
"$SYSROOT/usr/bin/rustup" default stable
"$SYSROOT/usr/bin/rustup" target add x86_64-pc-windows-msvc

echo "=== 3. Installing prebuilt cargo-xwin ==="
if [ ! -f "$CARGO_HOME/bin/cargo-xwin" ]; then
  XWIN_TAR="$PKG_CACHE/cargo-xwin.tar.gz"
  curl -fL --connect-timeout 8 -o "$XWIN_TAR" \
    "https://github.com/rust-cross/cargo-xwin/releases/download/v0.18.4/cargo-xwin-v0.18.4.x86_64-unknown-linux-musl.tar.gz"
  tar -xzf "$XWIN_TAR" -C "$CARGO_HOME/bin" cargo-xwin
  chmod +x "$CARGO_HOME/bin/cargo-xwin"
fi

echo "=== Toolchain setup complete! ==="
rustc --version
cargo --version
cargo-xwin --version
clang --version | head -n 1
lld-link --version

