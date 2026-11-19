#!/usr/bin/env bash
# Install and start the systemd user services for this checkout:
#   tablet-dash  - the dashboard server (needs node, codex, a logged-in Claude Code)
#   tablet-adb   - keeps the tablet's USB reverse port to the server alive
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
UNIT_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
PORT=${PORT:-8787}

NODE=$(command -v node) || { echo "node not found in PATH (need >= 18)" >&2; exit 1; }
CODEX=$(command -v codex) || { echo "codex not found in PATH" >&2; exit 1; }
ADB=${ADB:-$(command -v adb || echo "$HOME/Android/platform-tools/adb")}
[[ -x $ADB ]] || { echo "adb not found; set ADB=/path/to/adb" >&2; exit 1; }
[[ -f $HOME/.claude/.credentials.json ]] || echo "warning: ~/.claude/.credentials.json missing, run 'claude' and log in" >&2

# systemd doesn't load the login shell, so bake in the PATH that finds node and codex (nvm etc.)
SVC_PATH=$(dirname "$NODE"):$(dirname "$CODEX"):/usr/local/bin:/usr/bin:/bin

mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/tablet-dash.service" <<EOF
[Unit]
Description=Tablet dashboard (Claude/Codex limits + Pomodoro)

[Service]
Environment=PATH=$SVC_PATH
Environment=PORT=$PORT
ExecStart=$NODE $ROOT/server/server.js
Restart=on-failure

[Install]
WantedBy=default.target
EOF

cat > "$UNIT_DIR/tablet-adb.service" <<EOF
[Unit]
Description=Keep tablet USB reverse port to the dashboard

[Service]
Environment=ADB=$ADB
Environment=PORT=$PORT
ExecStart=$ROOT/scripts/adb-keeper.sh
Restart=always

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now tablet-dash.service tablet-adb.service
systemctl --user restart tablet-dash.service tablet-adb.service
echo "installed; check with: curl -s localhost:$PORT/api/limits"
