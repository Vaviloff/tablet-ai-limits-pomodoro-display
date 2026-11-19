#!/usr/bin/env bash
# Keep the tablet's localhost:PORT reversed to this PC; adb drops it on reconnects.
ADB=${ADB:-$(command -v adb || echo "$HOME/Android/platform-tools/adb")}
PORT=${PORT:-8787}
DIR=$(dirname "$0")

while true; do
  if [[ $($ADB get-state 2>/dev/null) == device ]] && ! $ADB reverse --list 2>/dev/null | grep -q "tcp:$PORT"; then
    echo "$(date -Is) restoring reverse tcp:$PORT"
    "$DIR/setup-tablet.sh" --no-open || true
  fi
  sleep 5
done
