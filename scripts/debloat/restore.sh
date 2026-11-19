#!/usr/bin/env bash
# Undo apply.sh: re-enable / reinstall-for-user everything in packages.txt.
# Restore a single package:  ./restore.sh <(echo "disable com.google.android.youtube")
#
# Android 7.0 has no `pm install-existing`, so "uninstall" entries are restored by opening
# the installer prompt for the package (package: URI -> installExistingPackage); tap INSTALL
# on the tablet for each one.
set -euo pipefail
ADB=${ADB:-$(command -v adb || echo "$HOME/Android/platform-tools/adb")}
LIST=${1:-$(dirname "$0")/packages.txt}

failed=()
while read -r method pkg _; do
  case $method in
    disable)
      out=$($ADB shell pm enable "$pkg" </dev/null 2>&1 | tr -d '\r') || true
      grep -q 'new state: enabled' <<<"$out" && { echo "ok    $pkg"; continue; } ;;
    uninstall)
      $ADB shell pm list packages </dev/null | tr -d '\r' | grep -qx "package:$pkg" && { echo "ok    $pkg (installed)"; continue; }
      $ADB shell am start -W -a android.intent.action.INSTALL_PACKAGE -d "package:$pkg" </dev/null >/dev/null
      read -rp "Tap INSTALL on the tablet for $pkg, then press Enter " </dev/tty
      $ADB shell pm list packages </dev/null | tr -d '\r' | grep -qx "package:$pkg" && { echo "ok    $pkg"; continue; }
      out="still not installed" ;;
    *) continue ;;   # blank lines and comments
  esac
  echo "FAIL  $pkg: $out"; failed+=("$pkg")
done < <(sed 's/#.*//' "$LIST")

((${#failed[@]} == 0)) || { echo "Failed: ${failed[*]}"; exit 1; }
