# Tablet AI limits + Pomodoro display

Turns an old Android tablet into an always-on desk display showing how much of
your **Claude Code** and **Codex** usage limits is left (5-hour window and week),
next to a **Pomodoro** timer.

There are two ways to run it:

```
A) Docker on an always-on box (NAS), tablet on Wi-Fi
   tablet (Chrome, fullscreen) ──Wi-Fi──▶ http://<nas-ip>:8787 ─ container: server/server.js
                                                                 ├─ Claude: api.anthropic.com/api/oauth/usage
                                                                 └─ Codex:  codex app-server

B) Your desktop, tablet on USB
   tablet (Chrome, fullscreen) ──USB──▶ adb reverse tcp:8787 ─ desktop: server/server.js (systemd)
```

The tablet only renders a page; the server returns usage percentages, never tokens.
**A** is the setup in use: the numbers keep updating when the desktop is off, and the
tablet only needs a charger. **B** keeps all logins on the desktop and never listens on
the network.

## Layout

| Path | What |
|---|---|
| `server/server.js` | Node server (no dependencies): serves `web/` and `GET /api/limits` (cached 60 s) |
| `Dockerfile`, `compose.yaml` | Container for setup A: server plus the `codex` and `claude` CLIs, logins in the `data` volume |
| `web/` | The page (ES5, works on Chrome 80 / Android 7), manifest, icons, service worker |
| `scripts/install-services.sh` | Installs the two systemd user services for this checkout |
| `scripts/setup-tablet.sh` | One-off tablet setup: reverse port, keep screen on, landscape, open page |
| `scripts/adb-keeper.sh` | Loop run by `tablet-adb.service`; re-applies the reverse port when adb drops it |
| `scripts/debloat/` | Reversible removal of Huawei/Google bloat on the tablet (`apply.sh` / `restore.sh`) |
| `NOTES.md` | Facts about the Huawei MediaPad T3 7 this was built for, and why it wasn't reflashed |

## A) Docker on a NAS, tablet on Wi-Fi

Needs Docker with Compose v2 on an x86-64 or arm64 Linux host. Pick a LAN address the
tablet can reach; a fixed IP or a DHCP reservation keeps it stable.

### 1. Start the container

```sh
git clone https://github.com/Vaviloff/tablet-ai-limits-pomodoro-display.git tablet-dash
cd tablet-dash
echo "BIND_IP=192.168.0.101" > .env      # the host's LAN IP; the default 127.0.0.1 is unreachable from the tablet
docker compose up -d --build
```

Only `BIND_IP:8787` is published. Don't forward it from the router.

### 2. Log in once, inside the container

The container keeps **its own** Claude Code and Codex logins in the `data` volume
(`/data/claude`, `/data/codex`). Don't mount your existing `~/.claude` or `~/.codex`.
Both services rotate refresh tokens, so two clients sharing one login keep logging each other out.
Limits are per account, so a separate login shows the same numbers.

```sh
docker compose exec tablet-dash codex login --device-auth   # open the URL, enter the code
docker compose exec tablet-dash claude auth login           # open the URL, paste the code back
curl -s <BIND_IP>:8787/api/limits                           # both "error": null
```

If Codex says device login is disabled, turn on device code authorization in ChatGPT's
security settings and retry.

Nothing runs `claude` interactively in the container, so the server refreshes that Claude
token itself (`CLAUDE_REFRESH=1` in the image) and writes it back to `/data/claude`.
Codex refreshes its own token.

To update: `git pull && docker compose up -d --build`. Logins survive because they're in the volume.

### 3. Point the tablet at it

1. **Treat the address as secure.** Chrome only installs a fullscreen web app from
   HTTPS or `localhost`. In Chrome open `chrome://flags`, search *Insecure origins treated as
   secure*, enter `http://<BIND_IP>:8787`, set it to *Enabled* and tap *Relaunch*.
   Serving it through an HTTPS reverse proxy is the alternative, but Android 7.0 lacks
   the current Let's Encrypt roots (ISRG Root X1/X2), so Chrome 80 rejects those certificates.
2. Open `http://<BIND_IP>:8787`, then in the menu tap **Add to Home screen**, and launch the icon.
3. Keep the screen on while it's charging from any source:
   `adb shell settings put global stay_on_while_plugged_in 7`. In the same session,
   lock landscape with `adb shell settings put system accelerometer_rotation 0` and
   `adb shell settings put system user_rotation 1`.

## B) Your desktop, tablet on USB

Here the server reads the desktop's own Claude Code and Codex logins. That machine needs Linux with systemd. On macOS, Claude Code
keeps its token in the Keychain rather than in `~/.claude/.credentials.json`, so the
server can't read it there without code changes.

### 1. Prerequisites

- **Node.js 18 or newer.** The server uses the built-in `fetch`. Check with `node -v`. nvm installs are fine.
- **Claude Code**, logged in with a Claude subscription (Pro/Max). Run `claude` once and
  make sure `~/.claude/.credentials.json` exists. API-key logins have no usage limits to show.
- **Codex CLI**, logged in with ChatGPT: `codex login`. The server spawns `codex app-server`
  for each refresh, so `codex` must be on your PATH.
- **adb.** Either install it from your distro (`sudo apt install adb`) or, without root:
  ```sh
  mkdir -p ~/Android && cd ~/Android
  curl -LO https://dl.google.com/android/repository/platform-tools-latest-linux.zip
  unzip platform-tools-latest-linux.zip && rm platform-tools-latest-linux.zip
  ```
  The scripts use `adb` from PATH, falling back to `~/Android/platform-tools/adb`.
  You can also set `ADB=/path/to/adb`.

### 2. Get the code and check the server by hand

```sh
git clone https://github.com/Vaviloff/tablet-ai-limits-pomodoro-display.git
cd tablet-ai-limits-pomodoro-display
node server/server.js            # PORT=8787 HOST=127.0.0.1 by default
curl -s localhost:8787/api/limits
```

You should get JSON with `claude` and `codex` objects, each with
`five_hour` / `weekly` → `{used, resets_at, window_min}` and `error: null`. If either
has an `error`, fix that before going further. Most often the login is missing or
expired: run `claude` or `codex login`. Stop the server with Ctrl+C.

### 3. Install the services

```sh
scripts/install-services.sh
```

This writes `~/.config/systemd/user/tablet-dash.service` and `tablet-adb.service`
with absolute paths to this checkout and to your `node`, `codex` and `adb`, then
enables and starts both. Re-run it whenever you move the checkout, switch Node
versions or change the port (`PORT=9000 scripts/install-services.sh`).

To keep the services running when you're not logged in to a desktop session:
`loginctl enable-linger $USER`.

Logs: `journalctl --user -u tablet-dash -u tablet-adb -f`

### 4. Connect the tablet

1. On the tablet, enable Developer options (tap *Build number* 7 times), then turn on
   **USB debugging**.
2. Plug it in, unlock the screen and accept **"Allow USB debugging?"**, ticking
   *Always allow*. If no prompt shows up, switch the USB mode to *File transfer* in the
   notification shade and replug. `adb devices` must show `device`, not `unauthorized`.
3. Within about 5 s `tablet-adb` applies the reverse port and tablet settings
   (`adb reverse --list` shows `tcp:8787`). Then open the page once:
   ```sh
   scripts/setup-tablet.sh
   ```
4. In Chrome on the tablet, open the menu and tap **Add to Home screen**. Launch the new
   **Limits** icon: it opens fullscreen in landscape without browser UI.

The tablet stays awake while it's on USB power (`svc power stayon usb`), and the page dims
itself between 23:00 and 07:00.

### Without a USB cable (optional)

- **adb over Wi-Fi** keeps everything else the same. While on USB, run
  `adb tcpip 5555`, then unplug and run `adb connect <tablet-ip>:5555`. The reverse port works over it.
  The tablet forgets this on reboot.
- **Plain LAN**: start the server with `HOST=0.0.0.0` and open `http://<pc-ip>:8787`.
  Anyone on the network can then read your usage numbers (no tokens are exposed). For
  fullscreen, set up the Chrome flag described in setup A, step 3.

## Using it

- **Limit bars** show % left. The white tick marks how much of the time window is left:
  a fill shorter than the tick means you're spending faster than the window passes.
  An `offline` badge means the tablet can't reach the server. A `stale` label on a card
  means that provider's last refresh failed and the last good numbers are shown.
- **Clock and temperature** above the timer. The temperature comes from Open-Meteo (no API key), fetched by the server every 10 minutes. The location defaults to Bishkek; change it with `WEATHER_LAT` and `WEATHER_LON` (in `compose.yaml` under `environment:` for Docker).
- **Screen stays on** while the dashboard is in front, on battery too, through the Screen Wake Lock API (Chrome 84+, secure context). Other apps keep the normal screen timeout.
- **Pomodoro**: 25 min focus, 5 min break, 15 min long break every 4 rounds. Tap the panel
  to start or pause, use *skip* / *reset*. It beeps and flashes at phase end; breaks start on their own,
  and focus waits for a tap. `/?fast` uses 6-second phases for testing.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Claude card `stale` / `unavailable` | Docker: check `docker compose logs`; if the refresh failed, run `claude auth login` in the container again. Desktop: the token in `~/.claude/.credentials.json` expired; run `claude` once to refresh it. |
| Codex card `stale` | Run `codex login` (in the container for Docker); check that `codex app-server` starts from the service's PATH (re-run the installer after switching Node versions). |
| `offline` badge | `systemctl --user status tablet-dash tablet-adb`, then `adb devices`, then `adb reverse --list`. |
| `adb devices` shows `no permissions` | Add a udev rule for the tablet's USB vendor ID, e.g. `SUBSYSTEM=="usb", ATTR{idVendor}=="12d1", MODE="0660", TAG+="uaccess"` in `/etc/udev/rules.d/51-android.rules`. |
