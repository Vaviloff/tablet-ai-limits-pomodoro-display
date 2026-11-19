#!/usr/bin/env bash
# Remove/disable the packages listed in packages.txt for user 0 (no root, reversible).
# Idempotent: already-removed/disabled packages are skipped. Undo with restore.sh.
set -euo pipefail
ADB=${ADB:-$(command -v adb || echo "$HOME/Android/platform-tools/adb")}
LIST=${1:-$(dirname "$0")/packages.txt}

installed=$($ADB shell pm list packages | tr -d '\r')
disabled=$($ADB shell pm list packages -d | tr -d '\r')
failed=()

while read -r method pkg _; do
  case $method in
    uninstall)
      grep -qx "package:$pkg" <<<"$installed" || { echo "skip  $pkg (not installed)"; continue; }
      cmd=(pm uninstall -k --user 0 "$pkg") ;;
    disable)
      grep -qx "package:$pkg" <<<"$disabled" && { echo "skip  $pkg (already disabled)"; continue; }
      cmd=(pm disable-user --user 0 "$pkg") ;;
    *) continue ;;   # blank lines and comments
  esac
  out=$($ADB shell "${cmd[@]}" </dev/null 2>&1 | tr -d '\r') || true
  if grep -qE '^Success|new state: disabled' <<<"$out"; then echo "ok    $method $pkg"
  else echo "FAIL  $method $pkg: $out"; failed+=("$pkg"); fi
done < <(sed 's/#.*//' "$LIST")

((${#failed[@]} == 0)) || { echo "Failed: ${failed[*]}"; exit 1; }
