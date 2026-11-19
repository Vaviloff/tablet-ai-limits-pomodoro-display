# Huawei MediaPad T3 7 (BG2-U01): limits + Pomodoro display

## Device
- Model BG2-U01 (MediaPad T3 7, 3G), build BG2-U01C170B182, Android 7.0 (SDK 24), patch 2019-03-01
- SoC Spreadtrum/Unisoc SC7731G (`sc8830`), 4x Cortex-A7 1.3 GHz, armeabi-v7a
- RAM 1 GB (~330 MB available idle), /data 4.1 GB, /system 98 % full
- Screen 600x1024 @ 213 dpi, about 770x450 CSS px in landscape
- Chrome 80, WebView 64
- Bootloader locked (`ro.boot.flash.locked=1`, verified boot green). The OEM-unlock toggle is allowed, but Huawei no longer issues unlock codes.

## Reflash verdict: no-go
- No LineageOS or other custom ROM exists for BG2-U01, and Android 7 devices aren't Treble, so generic GSIs are out.
- The public Unisoc unlock exploit (CVE-2022-38694 / spd_dump) targets newer Unisoc chips. SC7731G on Huawei isn't a known-working target.
- Even with an unlocked bootloader, the bottleneck is 1 GB RAM and Cortex-A7 cores. A newer ROM wouldn't make browsing or RSS feel fast.
- Cheap, reversible alternative: debloat with `pm uninstall --user 0 <pkg>` (undo with `cmd package install-existing <pkg>`) and set animations to 0. The setup script already sets animations to 0.

## Dashboard

### Current setup (since 2026-11-19)
- The server runs in Docker on the NAS (`storage`, 192.168.0.101) from `~/programs/tablet-dash`, published on `192.168.0.101:8787` (`.env`: `BIND_IP`). It has its own Claude Code and Codex logins in the compose `data` volume.
- The tablet reaches it over Wi-Fi at `http://192.168.0.101:8787`. Chrome flag *Insecure origins treated as secure* lists that origin, so the home-screen web app runs fullscreen.
- HTTPS through the NAS's Nginx Proxy Manager (`*.000255.xyz`) isn't used: that certificate chains to ISRG Root X2, which Android 7.0 doesn't trust.
- The tablet stays on while charging from any source (`stay_on_while_plugged_in=7`).
- The desktop units `tablet-dash` and `tablet-adb` are disabled. The notes below describe the USB setup they implemented.

### USB setup (desktop, now disabled)
- `server/server.js` is a Node server on 127.0.0.1:8787. It serves `web/` and `/api/limits`, with a 60 s cache.
  - Claude: `GET api.anthropic.com/api/oauth/usage` with the token from `~/.claude/.credentials.json`, reading `five_hour`/`seven_day` utilization and `resets_at`. The token is refreshed by Claude Code itself, so if `claude` isn't run for a long time the card goes "stale".
  - Codex: `codex app-server` JSON-RPC `account/rateLimits/read`, reading `primary` (5 h) and `secondary` (week) `usedPercent`/`resetsAt`.
- `web/index.html` is a single page in ES5. Polls every 60 s, shows an "offline" badge when the server is unreachable, and dims at 23:00–07:00.
  - The white tick on each bar marks how much of the window is left, so a fill shorter than the tick means usage is ahead of pace.
  - Pomodoro is 25/5 with a 15-minute long break every 4 rounds; state lives in localStorage. `/?fast` uses 6/4/5-second phases for testing.
- The tablet reaches the PC over USB via `adb reverse tcp:8787 tcp:8787`, so the server never listens on the LAN.
- systemd user units, written by `scripts/install-services.sh`:
  - `tablet-dash.service` runs the server.
  - `tablet-adb.service` runs `scripts/adb-keeper.sh`, which re-applies the reverse and the tablet settings whenever the forward is missing. adb drops it on reconnects.
- `scripts/setup-tablet.sh` applies the reverse, keep-awake on USB (`svc power stayon usb`), landscape lock and zero animations, then opens the page. `--no-open` skips opening the page.
- The home-screen icon "Limits" was added via Chrome "Add to Home screen". It runs in Chrome's WebappActivity, fullscreen, with no system bars.
- adb comes from Google platform-tools in `~/Android/platform-tools` (no sudo needed).

## Apps for reading and video
- Hardware video decoders: H.264 and VP8 only (`OMX.sprd.*`). VP9 and HEVC are software-only, so YouTube's default VP9 stutters above roughly 480p.
- **NewPipe** (F-Droid 0.29.3, installed with `adb install`, hash checked against F-Droid's index-v2). Default format MPEG-4 (H.264), default resolution 720p. Verified on Big Buck Bunny: `OMX.sprd.h264.decoder`, NewPipe at about 21 % CPU, no dropped frames logged.
- **RedReader** (F-Droid 1.27) for Reddit: a native client, light on RAM. Its login page runs in the system WebView.
- The system WebView provider is Chrome (`webview_provider=com.android.chrome`); the standalone WebView 64 is disabled. Updating Chrome therefore updates WebView for every app. Chrome 119 is the last version for Android 7.
- Play Store needs the Google account re-authenticated before it will update anything.
