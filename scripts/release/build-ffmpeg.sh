#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
root="$PWD"
[[ "$(uname -s)" == Darwin ]] || { echo 'Build FFmpeg prévu pour macOS.' >&2; exit 1; }
arch="$(uname -m)"
case "$arch" in
  arm64) target=aarch64-apple-darwin ;;
  x86_64) target=x86_64-apple-darwin ;;
  *) exit 1 ;;
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
  --extra-cflags=-mmacosx-version-min=11.0 --extra-ldflags=-mmacosx-version-min=11.0
make -j "$(sysctl -n hw.ncpu)" ffmpeg
lipo ffmpeg -verify_arch "$arch"
otool -L ffmpeg | tail -n +2 | awk '{print $1}' | while read -r dependency; do
  case "$dependency" in /usr/lib/*|/System/Library/*) ;; *) echo "Dépendance externe : $dependency" >&2; exit 1 ;; esac
done
./ffmpeg -version
./ffmpeg -L > "$resources/BUILD-LICENSE.txt" 2>&1
cp ffmpeg "$root/apps/HorusDesktop/src-tauri/binaries/ffmpeg-$target"
cp "$archive" LICENSE.md COPYING.LGPLv2.1 ffbuild/config.log "$resources/"
cp "$root/scripts/release/build-ffmpeg.sh" "$root/scripts/release/ffmpeg.json" "$resources/"
printf 'FFmpeg %s, sources officielles non modifiées.\nSource : %s\nSHA-256 : %s\nBinaire indépendant, lancé en sous-processus par Horus.\n' "$version" "$url" "$sha" > "$resources/NOTICE.txt"
