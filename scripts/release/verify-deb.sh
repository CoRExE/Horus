#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${VERSION:?Version requise}"
target=x86_64-unknown-linux-gnu
packages=(apps/HorusDesktop/src-tauri/target/"$target"/release/bundle/deb/*.deb)
[[ "${#packages[@]}" == 1 && -f "${packages[0]}" ]]
package="${packages[0]}"
[[ "$(dpkg-deb -f "$package" Architecture)" == amd64 ]]
[[ "$(dpkg-deb -f "$package" Version)" == "$VERSION" ]]
directory="$(mktemp -d "${RUNNER_TEMP:-/tmp}/horus-deb.XXXXXX")"
dpkg-deb -x "$package" "$directory"
# Horus must never replace a system FFmpeg package.
[[ ! -e "$directory/usr/bin/ffmpeg" ]]
node scripts/release/verify-desktop-files.mjs linux "$directory"
for binary in "$directory/usr/bin/horus-desktop" "$directory/usr/bin/horus-ffmpeg"; do
  dependencies="$(ldd "$binary")"
  printf '%s\n' "$dependencies"
  if [[ "$dependencies" == *'not found'* ]]; then exit 1; fi
done
sudo apt-get --simulate install "$PWD/$package"
mkdir -p build/installers
cp "$package" "build/installers/HorusDesktop-$VERSION-linux-x64.deb"
