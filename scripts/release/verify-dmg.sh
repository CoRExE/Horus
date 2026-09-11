#!/usr/bin/env bash
set -euo pipefail
image="$1"
arch="$2"
scripts="$(cd "$(dirname "$0")" && pwd)"
hdiutil verify "$image"
mount="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/horus-dmg.XXXXXX")"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then
    # Spotlight can briefly hold a newly mounted image after verification.
    hdiutil detach "$mount" || hdiutil detach -force "$mount"
  fi
  rmdir "$mount"
}
trap cleanup EXIT
hdiutil attach "$image" -readonly -nobrowse -mountpoint "$mount"
mounted=true
bash "$scripts/verify-macos.sh" "$mount/Horus Desktop.app" "$arch"
