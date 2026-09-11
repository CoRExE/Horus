#!/usr/bin/env bash
set -euo pipefail
app="$1"
arch="$2"
binary="$app/Contents/MacOS/horus-desktop"
ffmpeg="$app/Contents/MacOS/ffmpeg"
codesign --verify --deep --strict --verbose=2 "$app"
for executable in "$binary" "$ffmpeg"; do
  lipo "$executable" -verify_arch "$arch"
  otool -L "$executable" | tail -n +2 | awk '{print $1}' | while read -r dependency; do
    case "$dependency" in /usr/lib/*|/System/Library/*) ;; *) echo "Dépendance externe : $dependency" >&2; exit 1 ;; esac
  done
done
env PATH=/usr/bin:/bin "$ffmpeg" -version
test -f "$app/Contents/Resources/licenses/ffmpeg/COPYING.LGPLv2.1"
test -f "$app/Contents/Resources/licenses/ffmpeg/ffmpeg-8.0.1.tar.xz"
