# Focus 📱

A task manager built for people who lose track of time — with **nag reminders**
that keep firing until you actually do the thing. Built, shipped, and used
entirely from a phone: the code lives here, GitHub Actions builds the app,
and you install it straight from your browser.

## Install on your Android phone

1. Open **[the latest release](https://github.com/FunkeePanda/Claude_taskapp/releases/latest)** in Chrome.
2. Download the `.apk` file under **Assets**.
3. Open the download. Android will warn about installing unknown apps —
   allow Chrome (or your file manager) as a source. This is a one-time step.
4. Tap **Install**. Done.

**Updating:** just download the newer APK from the same link and open it —
it installs *over* the old version and **your tasks are kept**. Never uninstall
to update (that would wipe your data).

### First-run checklist

- Open **Settings → Enable notifications** and accept the prompt.
- Tap **🔔 Test notification in 2 minutes**, then swipe the app away.
  If the notification arrives with the app closed, reminders will work.
- If nags ever stop arriving: go to Android Settings → Apps → Focus →
  Battery → **Unrestricted**. Some phones (Xiaomi, Huawei, Samsung with
  aggressive battery savers) kill scheduled alarms otherwise.

## What it does

- **Smart Today view** — picks a small focus list from due dates, priority,
  and how long tasks have been sitting. Overdue tasks are always shown.
- **Natural-language quick add** — type `pay rent friday 5pm high priority every 2h #bills`
  and it parses the date, time, priority, nag interval, and tags into chips
  you can tap away if it guessed wrong.
- **Nag reminders** — "remind me every 30 minutes until I do it." Notifications
  keep coming (even with the app closed) until you tap **✓ Done** — right from
  the lockscreen. **Snooze 1h** when you need a break. Quiet hours (default
  22:00–08:00) are respected.
- **Energy matching** — tag tasks ⚡ quick win or 🧠 deep focus, then tell the
  app how you're feeling; it reorders your list to match (and resets after 4h).
- **Backup** — Settings → Export shares a JSON file (save it to Drive/anywhere);
  Import restores it. Do this now and then — it's your safety net.

## Web preview

The same app runs at the repo's GitHub Pages URL for a quick look at UI
changes without installing anything. Everything works there **except
notifications** — those need the installed app.

## How this repo works (no computer required)

| Piece | What it does |
|---|---|
| `www/` | The entire app: vanilla HTML/CSS/JS, no build step |
| `www/js/native.js` | Shim: real Capacitor plugins on-device, mocks in a browser |
| `android/` | Committed Capacitor Android project (manifest, signing, icons) |
| `.github/workflows/android-apk.yml` | Builds a signed APK on every push → [releases/latest](https://github.com/FunkeePanda/Claude_taskapp/releases/latest) |
| `.github/workflows/pages.yml` | Deploys `www/` to GitHub Pages on every push |
| `test/` | Unit tests for the parser, focus scoring, and reminder math (`npm test`) |

**Signing:** the keystore is committed on purpose. This app is personal and
sideloaded — the key secures nothing, but a *constant* key is what lets each
new build install over the last one with data intact. If the repo ever needs
a real distribution story, move the keystore to a GitHub Secret.

**Version code** comes from the CI run number, so it always increases and
Android always accepts the update.

## Known limitations

- Nags are scheduled ~12 hours ahead (Android limits pending alarms).
  Opening the app refills the window — if you don't open it for a day,
  nags pause until you do.
- "Clear app data" in Android settings wipes tasks. Export regularly.
- Tasks live on this one device (by design — no accounts, no cloud).
  Moving phones = export on the old one, import on the new one.
