# Tablet AI limits + Pomodoro display

Turns an old Android tablet into an always-on desk display showing how much of
your **Claude Code** and **Codex** usage limits is left (5-hour window and week),
next to a **Pomodoro** timer.

```
tablet (Chrome, fullscreen)  ──USB──  PC: adb reverse tcp:8787 → server/server.js
                                          ├─ Claude: api.anthropic.com/api/oauth/usage
                                          └─ Codex:  codex app-server (account/rateLimits/read)
```

The tablet only renders a page. All credentials stay on the PC, and the server listens on
`127.0.0.1` only. The tablet reaches it through `adb reverse` over the USB cable,
which also keeps it charged.

## Layout

| Path | What |
|---|---|
| `server/server.js` | Node server (no dependencies): serves `web/` and `GET /api/limits` (cached 60 s) |
| `web/` | The page (ES5, works on Chrome 80 / Android 7), manifest, icons, service worker |
| `scripts/install-services.sh` | Installs the two systemd user services for this checkout |
| `scripts/setup-tablet.sh` | One-off tablet setup: reverse port, keep screen on, landscape, open page |
| `scripts/adb-keeper.sh` | Loop run by `tablet-adb.service`; re-applies the reverse port when adb drops it |
| `NOTES.md` | Facts about the Huawei MediaPad T3 7 this was built for, and why it wasn't reflashed |

## Setting up the server on another machine

The server must run on the machine where you use Claude Code and Codex, because it
reads their logins. That machine needs Linux with systemd. On macOS, Claude Code
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
  This has two downsides. Anyone on the network can read your usage numbers (no tokens
  are exposed). And because the page isn't on `localhost`, it's not a secure context, so
  Chrome won't install it as a fullscreen web app.

## Using it

- **Limit bars** show % left. The white tick marks how much of the time window is left:
  a fill shorter than the tick means you're spending faster than the window passes.
  An `offline` badge means the tablet can't reach the server. A `stale` label on a card
  means that provider's last refresh failed and the last good numbers are shown.
- **Pomodoro**: 25 min focus, 5 min break, 15 min long break every 4 rounds. Tap the panel
  to start or pause, use *skip* / *reset*. It beeps and flashes at phase end; breaks start on their own,
  and focus waits for a tap. `/?fast` uses 6-second phases for testing.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Claude card `stale` / `unavailable` | The OAuth token in `~/.claude/.credentials.json` expired. Run `claude` once and it refreshes the token. |
| Codex card `stale` | Run `codex login`; check that `codex app-server` starts from the service's PATH (re-run the installer after switching Node versions). |
| `offline` badge | `systemctl --user status tablet-dash tablet-adb`, then `adb devices`, then `adb reverse --list`. |
| `adb devices` shows `no permissions` | Add a udev rule for the tablet's USB vendor ID, e.g. `SUBSYSTEM=="usb", ATTR{idVendor}=="12d1", MODE="0660", TAG+="uaccess"` in `/etc/udev/rules.d/51-android.rules`. |
