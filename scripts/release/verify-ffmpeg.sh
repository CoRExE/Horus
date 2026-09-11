#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
binary="$1"
target="$2"
case "$target" in
  aarch64-apple-darwin|x86_64-apple-darwin)
    if [[ "$target" == aarch64-* ]]; then arch=arm64; else arch=x86_64; fi
    lipo "$binary" -verify_arch "$arch"
    otool -L "$binary" | tail -n +2 | awk '{print $1}' | while read -r dependency; do
      case "$dependency" in /usr/lib/*|/System/Library/*) ;; *) echo "Dépendance externe : $dependency" >&2; exit 1 ;; esac
    done
    ;;
  x86_64-unknown-linux-gnu)
    readelf -h "$binary" | grep -Eq 'Machine:.*X86-64'
    readelf -d "$binary" | sed -n 's/.*Shared library: \[\(.*\)\]/\1/p' | while read -r dependency; do
      case "$dependency" in libc.so.6|libm.so.6|libpthread.so.0|libdl.so.2|librt.so.1|ld-linux-x86-64.so.2) ;; *) echo "Dépendance externe : $dependency" >&2; exit 1 ;; esac
    done
    ;;
  x86_64-pc-windows-msvc)
    objdump -f "$binary" | grep -q 'file format pei-x86-64'
    objdump -p "$binary" | sed -n 's/.*DLL Name: //p' | tr '[:upper:]' '[:lower:]' | tr -d '\r' | while read -r dependency; do
      case "$dependency" in kernel32.dll|advapi32.dll|bcrypt.dll|user32.dll|ws2_32.dll|secur32.dll|shell32.dll|ole32.dll|oleaut32.dll|psapi.dll|shlwapi.dll|gdi32.dll|avicap32.dll|msvfw32.dll|winmm.dll|msvcrt.dll|ucrtbase.dll|api-ms-win-crt-*.dll) ;; *) echo "DLL externe : $dependency" >&2; exit 1 ;; esac
    done
    ;;
  *) echo "Cible inconnue : $target" >&2; exit 1 ;;
esac
"$binary" -version
