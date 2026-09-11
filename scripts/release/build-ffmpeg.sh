#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
root="$PWD"
arch="$(uname -m)"
options=()
binary=ffmpeg
sidecar=horus-ffmpeg
case "$(uname -s):$arch" in
  Darwin:arm64|Darwin:x86_64)
    if [[ "$arch" == arm64 ]]; then target=aarch64-apple-darwin; else target=x86_64-apple-darwin; fi
    sidecar=ffmpeg
    jobs="$(sysctl -n hw.ncpu)"
    options+=(--extra-cflags=-mmacosx-version-min=11.0 --extra-ldflags=-mmacosx-version-min=11.0)
    ;;
  Linux:x86_64)
    target=x86_64-unknown-linux-gnu
    jobs="$(nproc)"
    ;;
  MINGW*:x86_64)
    [[ "${MSYSTEM:-}" == UCRT64 ]] || { echo 'Utiliser MSYS2 UCRT64.' >&2; exit 1; }
    # The standalone MinGW executable is also usable alongside the MSVC Tauri app.
    target=x86_64-pc-windows-msvc
    binary=ffmpeg.exe
    jobs="$(nproc)"
    options+=(--extra-ldflags=-static)
    ;;
  *) echo 'Plateforme FFmpeg non prise en charge.' >&2; exit 1 ;;
esac
version="$(node -p 'require("./scripts/release/ffmpeg.json").version')"
url="$(node -p 'require("./scripts/release/ffmpeg.json").url')"
sha="$(node -p 'require("./scripts/release/ffmpeg.json").sha256')"
work="$root/build/ffmpeg/$target"
resources="$root/apps/HorusDesktop/src-tauri/resources/ffmpeg"
mkdir -p "$work" "$resources" "$root/apps/HorusDesktop/src-tauri/binaries"
archive="$work/ffmpeg-$version.tar.xz"
if [[ ! -f "$archive" ]]; then
  curl --fail --location --retry 3 "$url" --output "$archive"
fi
printf '%s  %s\n' "$sha" "$archive" | shasum -a 256 --check
if [[ ! -d "$work/ffmpeg-$version" ]]; then tar -xJf "$archive" -C "$work"; fi
cd "$work/ffmpeg-$version"
# A standalone LGPL executable, with no Homebrew libraries or GPL/nonfree codecs.
# Horus uses stream copy and the built-in AAC encoder; no x264 encoder is needed.
./configure --disable-autodetect --disable-shared --enable-static \
  --disable-gpl --disable-nonfree --disable-version3 --disable-doc --disable-debug \
  --disable-ffplay --disable-ffprobe --disable-x86asm \
  "${options[@]}"
make -j "$jobs" "$binary"
bash "$root/scripts/release/verify-ffmpeg.sh" "$PWD/$binary" "$target"
./"$binary" -L > "$resources/BUILD-LICENSE.txt" 2>&1
extension="${binary#ffmpeg}"
cp "$binary" "$root/apps/HorusDesktop/src-tauri/binaries/$sidecar-$target$extension"
cp "$archive" LICENSE.md COPYING.LGPLv2.1 ffbuild/config.log "$resources/"
cp "$root/scripts/release/build-ffmpeg.sh" "$root/scripts/release/verify-ffmpeg.sh" "$root/scripts/release/ffmpeg.json" "$resources/"
printf 'FFmpeg %s, sources officielles non modifiées.\nSource : %s\nSHA-256 : %s\nBinaire indépendant, lancé en sous-processus par Horus.\n' "$version" "$url" "$sha" > "$resources/NOTICE.txt"
