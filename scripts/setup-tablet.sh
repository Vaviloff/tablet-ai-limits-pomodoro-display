#!/usr/bin/env bash
# Point the tablet at the dashboard over USB and keep it awake.
set -euo pipefail
ADB=${ADB:-$(command -v adb || echo "$HOME/Android/platform-tools/adb")}
PORT=${PORT:-8787}

$ADB wait-for-device
$ADB reverse tcp:$PORT tcp:$PORT
$ADB shell svc power stayon usb                       # screen stays on while on USB power
$ADB shell settings put system accelerometer_rotation 0
$ADB shell settings put system user_rotation 1        # landscape
for k in window_animation_scale transition_animation_scale animator_duration_scale; do
  $ADB shell settings put global $k 0
done

if [[ ${1:-} != --no-open ]]; then
  $ADB shell am start -a android.intent.action.VIEW -d "http://localhost:$PORT/" com.android.chrome >/dev/null
fi
