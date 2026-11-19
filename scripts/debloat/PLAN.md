# Tablet debloat plan

Device: Huawei MediaPad T3 7 (BG2-U01, build BG2-U01C170B182), Android 7.0 / EMUI 5,
Spreadtrum SC7731G, 1 GB RAM. No root, locked bootloader.
Use: fullscreen Chrome web app ("Limits", `adb reverse tcp:8787`) + Tiny Tiny RSS (`org.fox.ttrss`).

Files: `packages.txt` (the list), `apply.sh` (apply, idempotent), `restore.sh` (undo).

## Method

Every entry uses `pm disable-user --user 0 <pkg>`; undo is `pm enable <pkg>` (`restore.sh`).

`pm uninstall -k --user 0` was ruled out. Android 7.0's `pm` has no `install-existing`
(it arrived in 8.0), and `pm install -r /system/...apk` fails because the system APKs are
odexed (`INSTALL_PARSE_FAILED_NO_CERTIFICATES ... classes.dex does not exist`). The only
way to undo it on N is the installer prompt
(`am start -a android.intent.action.INSTALL_PACKAGE -d package:<pkg>`, then tap INSTALL).
That was tested on `com.android.dreams.phototable` and it works, but it needs a tap on the
tablet. A disabled package can't run, receive broadcasts or keep services alive, so the
RAM saving is the same as uninstalling. `restore.sh` still handles `uninstall` lines through
the prompt in case one gets added later.

## Before state (2026-11-19, uptime 59 min, dashboard in foreground)

| metric | value |
|---|---|
| `/proc/meminfo` MemAvailable | 328,224 kB |
| `dumpsys meminfo` Free RAM | 380,575 K (54,087 cached pss + 294,088 cached kernel + 32,400 free) |
| `dumpsys meminfo` Used RAM | 741,018 K (614,822 used pss) |
| ZRAM | 117 MB physical for 242 MB swapped |
| packages | 133 (1 disabled: com.google.android.webview, which is expected because Chrome provides WebView on N) |

Top resident processes that aren't needed: `googlequicksearchbox:search` 46 MB
(StandaloneKeepAlive service), `com.huawei.imonitor` 14 MB, `com.huawei.android.cochr`
7.4 MB (persistent), `com.huawei.android.hwouc` + `:hwbdservice` 10.5 MB,
`com.huawei.android.totemweather` 5.7 MB, `partnerbrowsercustomizations.tmobile` 4 MB.
That's about 88 MB of PSS, and the rest of the list stops apps from waking on boot,
connectivity or package broadcasts.

## Packages to disable (30)

### Google apps (not used on this tablet)
| package | reason |
|---|---|
| com.google.android.googlequicksearchbox | Google app. Keeps a 46 MB `:search` process alive. The home-screen search bar widget goes away (accepted). |
| com.google.android.youtube | unused |
| com.google.android.apps.maps | unused, location/background sync |
| com.google.android.apps.photos | unused, backup and media scanning jobs |
| com.google.android.apps.docs | Drive, unused |
| com.google.android.apps.tachyon | Duo, unused, wakes on connectivity |
| com.google.android.gm | Gmail, unused, sync adapter |
| com.google.android.music | Play Music (dead service) |
| com.google.android.videos | Play Movies |
| com.google.android.marvin.talkback | accessibility suite, unused |
| com.google.android.feedback | feedback/crash-report UI only |
| com.google.android.printservice.recommendation | print-service recommender |

### Huawei / OEM extras
| package | reason |
|---|---|
| com.huawei.android.totemweather | weather and clock widget. Always running and polls the network. The home clock/weather widget goes away; the status bar still shows the time. |
| com.huawei.android.hwouc | system updater, 2 resident processes. The device is EOL (B182), so it gets no updates. |
| com.huawei.himovie | Huawei Video |
| com.android.mediacenter | Huawei Music |
| com.huawei.KoBackup | Huawei Backup |
| com.huawei.kidsmode.kidspaint | kids demo app |
| com.huawei.android.wfdft | MirrorShare / Wi-Fi Display projection |
| com.android.email, com.android.exchange | Huawei Email and its Exchange sync |
| com.example.android.notepad | Huawei Notepad |
| com.android.soundrecorder | Huawei Recorder |
| com.android.dreams.phototable | photo screensaver |
| com.opera.preinstall | Opera preinstall stub provider |
| com.android.partnerbrowsercustomizations.tmobile | partner homepage provider. Chrome starts it (4 MB process) and the dashboard doesn't need it. |
| com.touchtype.swiftkey, com.swiftkey.swiftkeyconfigurator | inactive keyboard. Gboard (`com.google.android.inputmethod.latin`) is the default IME. |

### Huawei telemetry (system uid, resident)
| package | reason |
|---|---|
| com.huawei.imonitor | log collector (NcLogCollectService/LogCollectService/PTMService), about 14 MB |
| com.huawei.android.cochr | CHR network/call logging and modem log service. Persistent, about 7 MB. |

## Kept on purpose
- Chrome, WebView, Huawei launcher, SystemUI, Settings, Google package installer, Gboard (active IME),
  GMS/GSF/Play Store, `org.fox.ttrss` + `org.fox.ttrss.key`, keyguard (`com.android.keyguard` = HwMagazine),
  telephony stack (phone, telecom, incallui, mms, stk, providers), media/download/settings providers.
- `com.huawei.systemmanager` and `com.huawei.powergenie`: core EMUI power and permission management.
  Removing them is reported to bootloop or break app launch.
  `com.huawei.iaware`, `com.huawei.android.hwaps`, `com.huawei.android.hsf` and
  `com.huawei.android.internal.app` (resolver) are kept for the same reason.
- `com.android.contacts` (persistent, about 16 MB): EMUI's Contacts/Dialer is part of the telephony UI.
  Disabling it is possible but untested here, so it stays.
- `com.huawei.hidisk`: this is the EMUI **Files** app (file manager), not just cloud. It isn't running.
- `com.huawei.hwid`, `com.huawei.android.thememanager`, `com.huawei.iconnect`, `com.huawei.motionservice`,
  `com.huawei.internetaudioservice`, `com.google.android.tts`: not running, and the effect of disabling them
  on EMUI 5 is uncertain (wallpaper/theme settings, gestures, Chrome speech). Left alone.
- `org.leetzone.android.yatsewidgetfree` (Yatse): user-installed.
- appops `RUN_IN_BACKGROUND`: none of the kept heavy apps is a good candidate. Most are system/persistent,
  or they're Chrome, GMS, launcher or TT-RSS. Skipped.

## Results (2026-11-19)

`apply.sh` disabled all 30 packages with no failures. A second run skipped all 30, so it's idempotent.
Packages: 133 installed, 31 disabled (30 from this list plus the existing WebView).

Checked before the reboot: the launcher works, the "Limits" web app loads live data,
TT-RSS opens and syncs over Wi-Fi, Gboard appears in the Chrome omnibox, and Wi-Fi stays connected.
The home screen lost the Google search bar, the weather/clock widget and the "Google" folder,
because all of its apps were disabled. Play Movies, Play Music and Email are gone from the dock.

One reboot afterwards: `sys.boot_completed` came up in about 54 s and `adb reverse` tcp:8787 was
back within 3 s. The keyguard works, but the pattern lock had to be entered by hand.
The dashboard relaunched and showed data. The rotation, stay-on and animation settings are unchanged.

### After state (uptime 9 min, dashboard in foreground)

| metric | before | after |
|---|---|---|
| `/proc/meminfo` MemAvailable | 328,224 kB | 366,652 kB (+38 MB) |
| `dumpsys meminfo` Used RAM, used pss (non-cached processes) | 614,822 K | 478,002 K (−137 MB) |
| `dumpsys meminfo` Free RAM | 380,575 K | 588,882 K (+208 MB) |
| cached-process pss (reclaimable) | 54,087 K | 223,929 K |

MemAvailable gains less than "used pss" drops because the freed RAM is now holding killable cached
processes: Play Store (3 processes, about 100 MB, doing its post-boot update check), the GMS UI and
unstable processes, and MMS. The kernel's MemAvailable doesn't count those as free, but lmkd
reclaims them first. Gone entirely: the `googlequicksearchbox:search` keep-alive, imonitor,
hwouc (×2), totemweather and the partner-bookmarks process. All before/after numbers are single
samples and fluctuate by ±20 MB.

### Notes and things not done
- `com.huawei.android.cochr` still shows a persistent process (about 4 MB, down from 7.4 MB). It is
  shared with `com.huawei.sarcontrolservice` (SAR/radio power control, kept), which keeps it alive.
  The CHR services themselves (ChrService, MdlogService, ChrLogService, ChrStatService) no longer run.
- The native `/system/bin/imonitor` daemon (about 3.4 MB) is started by init and can't be stopped without root.
- No appops `RUN_IN_BACKGROUND` changes. `appops` exists on this build, but none of the kept apps
  was a safe candidate.
- `com.android.dreams.phototable` was briefly removed with `pm uninstall --user 0` while testing the
  undo path, restored through the installer prompt, and then disabled like the rest.

### Further candidates, left alone on purpose
- `com.android.mms` (17.5 MB, starts after boot). Disable it only if SMS is never used on this SIM tablet.
- `com.huawei.hwid` (`:pushservice`, 5 MB A-service). Huawei ID/push. Probably safe to disable, but
  themes and Huawei account features depend on it.
- `com.android.gallery3d` (8.5 MB MediaSyncerService) and `com.android.calendar`: they start after boot.
  Disabling them loses the gallery/calendar apps.
- `com.android.contacts` (persistent, 16 MB): EMUI Contacts/Dialer.
- Play Store background churn: turn off "Auto-update apps" in Play Store settings if the post-boot
  update check is noticeable. That's a manual UI setting, not done here.
