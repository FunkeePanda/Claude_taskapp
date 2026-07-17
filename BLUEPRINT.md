# Build "Focus" — Complete Blueprint & Roadmap

**Your mission:** build a personal task-manager app called **Focus** from
scratch, in your own project, to the exact specification below. This blueprint
comes from a finished, working version of the app — every value, behavior, and
architecture decision here is proven in production. Treat it as the product
spec AND the roadmap: the design is final (the owner loves it — match it, don't
reinterpret it), the behaviors are exact requirements, and the pitfalls at the
end are real bugs that already cost days. You are building for one
non-programmer owner who runs it on Android and shares it with an iPhone user.

---

## ⚠️ How the owner builds and tests — READ THIS FIRST

**The owner works entirely from their phone. There is no computer in this
workflow. Ever.** This shapes everything you do:

- **Never** ask the owner to run a command, open a terminal, install a
  toolchain, use an IDE, or visit `localhost`. If a step needs any of that,
  it's YOUR step, done in your environment or in CI.
- **You write all code and push it; GitHub Actions builds everything.**
  Git push → CI → live deploy/release is the ONLY build path. Set the
  pipelines up first (§13 phase 1) because nothing can be tested without
  them.
- **Android testing loop (the owner's own phone):** every push produces a
  **signed APK attached to a rolling GitHub release with a stable download
  URL**. The owner opens that release page in their phone browser, downloads
  `focus.apk`, and installs it right over the previous version (sideload —
  their tasks survive because the signing key never changes). This is how
  they test every Android change. Keep the release name showing the build
  number so they can confirm what they're on (also show it in Settings →
  About). Expect and handle sideload friction: "install unknown apps"
  permission per-browser, Chrome's "harmful file" warning needing "Download
  anyway", and stale/corrupt downloads causing "App not installed" (fix:
  delete old focus.apk files, re-download).
- **iOS testing loop (a friend's iPhone):** the same `www/` folder deploys to
  a **public GitHub Pages URL**. The iPhone user opens it in Safari →
  **Share → Add to Home Screen** — that installed icon IS the iOS app, and
  it's the only context where iOS allows Web Push. The owner shares that one
  URL; after updates nobody re-installs anything (the app self-reloads new
  builds, §11). Push notifications additionally need the Cloudflare Worker
  (§10) deployed and its URL + VAPID public key wired into the client.
- **Anything only the owner can do must be phone-sized.** Account setup
  (e.g. creating the Cloudflare account, adding GitHub repo secrets) happens
  in their phone browser — give exact tap-by-tap paths, one step at a time,
  and have them paste values into the repo's Settings → Secrets page. You
  generate anything generatable (keys, ids) yourself and hand them the value.
- **Verify before you hand over.** The owner is the final on-device tester,
  but their time is expensive: before saying "try it," you must have run the
  unit tests, driven the UI headlessly (Playwright against a static server of
  `www/`), curled the live Pages/Worker URLs to confirm the deploy actually
  landed, and checked CI is green. On-device notification delivery is the
  ONE thing you can't verify — for iOS you can get close with the Worker's
  `/status` log; for Android, tell the owner exactly what to do and what
  they should see ("set a task due 5 minutes out, close the app, watch the
  lock screen").

## 1. Product in one paragraph

A fast, beautiful, offline-first task app for two phones: a **signed Android
APK** (sideloaded, no Play Store) and an **installable iPhone home-screen web
app** — one codebase for both. Headline features: natural-language quick-add,
nested subtasks with animated tree UI, an auto-picked daily focus list,
persistent "nag me every X minutes" reminders, one-shot alerts at a task's due
time, focus sessions with work/break cycles, a calendar, tag/color filtering,
swipe gestures, a signature check-off animation, and 8 color-psychology theme
presets. No accounts, no analytics; all data on-device.

## 2. Non-negotiable engineering principles

1. **No build step.** The web app is plain HTML/CSS/JS ES modules in a `www/`
   folder, served verbatim. No framework, no bundler, no runtime npm
   dependencies in the web app. Small modules; pure logic kept separate from
   DOM code so it's unit-testable.
2. **One codebase, two platforms.** Wrap `www/` with **Capacitor 7** for
   Android. Serve the same `www/` from **GitHub Pages** as a PWA for iPhone.
   A single `isNative` boolean (Capacitor detection, in one module, e.g.
   `native.js`) gates every platform difference. Web preview in a desktop
   browser must always work with mocks.
3. **Everything ships from CI.** The owner runs no local toolchain. Git push →
   GitHub Actions → Pages deploy + APK release (+ push-backend deploy). Set
   this up in phase 1, not last.
4. **Privacy:** the only server component is a tiny push relay for iOS (§10);
   it sees reminder titles and fire times, nothing else.

## 3. Data model & persistence

Single versioned JSON document in `localStorage` (e.g. key `focus.data.v1`)
with a last-known-good backup copy (`.bak`) written before each overwrite as
corruption protection. Debounce saves ~250ms. On load, backfill defaults for
any field added later (migration pattern). Change listeners drive re-renders
and reminder re-planning.

```js
task = {
  id,                  // int, monotonic counter in meta
  title, notes,
  due,                 // epoch ms | null
  allDay,              // true = date-only (stamp internally at 23:59 local)
  priority,            // 0 low / 1 normal / 2 high
  tags,                // string[] lowercase, stored without '#'
  color,               // one of the 8 category hexes (§6) | null
  reminder,            // { intervalMin, startAt|null } | null  ("nag every…")
  timer,               // { durationMin } | null  (how long task should take)
  breaks,              // { workMin, breakMin } | null  (pomodoro cycle)
  muteDuringSession,   // default true
  session,             // { startedAt } | null  (a running focus session)
  parentId,            // nesting, arbitrary depth; orphaned parentId renders top-level
  collapsed,           // subtree hidden in the tree UI
  archived,            // lives in Done section (whole subtree together)
  createdAt, completedAt,
}
settings = { quietStart:'22:00', quietEnd:'08:00', focusLimit:5, theme:'ember' }
```

Model helpers you'll need everywhere: `childrenOf`, `descendantsOf`,
`progressOf(id) -> {done,total}` over the subtree, `setArchived(id, bool)`
(applies to whole subtree), `completeWithDescendants(id) -> flippedIds`,
`deleteTask(id)` (deletes whole subtree). Export/import = the whole document
as JSON, validated before replacing.

## 4. App shell & navigation

- `index.html`: a `<main id="view">`, a fixed bottom tab bar with **3 tabs —
  Tasks · Calendar · Settings** (SVG stroke icons), a round accent **FAB (+)**
  above the tab bar, plus empty roots for sheets and toasts.
- Hash routing. `rerender()` must re-render the current view **without visual
  reset**: preserve scroll position and open `<details>`, no entry animation
  replay. A 30-second interval calls `rerender()` so live chips (countdowns,
  "next in Xm") stay current — **paused while a sheet is open** so re-renders
  never eat a user's edit.
- View entry animation: cards stagger in (each card delayed by its index).
- PWA extras: `manifest.webmanifest` with **relative** `start_url`/`scope`
  (works under a Pages subpath), 192/512px icons, apple-touch-icon 180px,
  `apple-mobile-web-app-capable`, `black-translucent` status bar, and
  `env(safe-area-inset-*)` padding in CSS.

## 5. Design system (match exactly)

Font: **Inter**, `system-ui` fallback. Card radius **16px**, small radius
**10px**. Tab bar 64px + safe-area. Cards: 1px border, elevation via
background steps not shadows (shadow reserved for sheets/FAB). Body text
0.95–0.98rem, titles 1.65rem/700, section labels 0.78rem uppercase
letter-spaced, chip text 0.72rem/600.

**Every color is a CSS custom property on `:root`. Never hardcode a color in
a component.** Token set (default theme "Midnight Ember" — THE look):

```css
--bg:#1b2026;  --bg-elev:#242b33;  --bg-elev-2:#2e3742;   /* page→card→nested ladder */
--text:#e8eaed; --text-dim:#97a3b0; --text-faint:#64707d;  /* 3-step text ramp */
--accent:#a63446; --accent-bright:#c4576a; --accent-deep:#7c2434;
--accent-soft:rgba(166,52,70,.18);
--good:#3ecf8e; --warn:#f39c12; --danger:#ff6b5e;
--border:rgba(255,255,255,.07); --tree-line:rgba(255,255,255,.16);
--shadow:0 8px 24px rgba(0,0,0,.35); --accent-shadow:rgba(166,52,70,.45);
```

Global: `user-select:none` + `-webkit-touch-callout:none` on body (Safari
needs both), re-enabled on inputs/textareas. `touch-action: manipulation` on
all buttons/chips (kills iOS double-tap-zoom delay). Focused inputs get accent
border + `box-shadow: 0 0 0 3px var(--accent-soft)` that persists until blur.

**Chips** (the app's signature element): pill radius 999px, `--bg-elev-2`
background, used for task metadata, filters, pickers, and the editor toolbar.
Variants: due (accent-soft bg when today, danger tint when overdue), nag
(accent-bright text), progress "2/5" (accent-soft), priority-high (danger
tint), category (colored dot + 20% color-mix bg), active filter (accent-soft).

**Category colors** (per-task `color` field, independent of themes):
rose `#C4576A` · ember `#D96C47` · amber `#D9A441` · moss `#7FA65A` ·
teal `#4A9E8F` · steel `#5B84A8` · violet `#8A6FB8` · slate `#8B97A3`.
Picker = 34px round swatches, selected gets a double-ring box-shadow.

## 6. Theme presets (Settings → Appearance)

8 themes across 4 **color-psychology families**, live-preview, persisted in
settings, applied by setting the CSS variables inline on `<html>` plus
`color-scheme` and the `<meta name="theme-color">`. Every theme defines the
FULL token set. **Light themes use shell-white/manila surfaces — NEVER pure
`#ffffff` cards** (explicit owner requirement: "the white is really
powerful"). Enforce WCAG AA in a unit test: text ≥4.5:1 on all three
backgrounds, dim-text ≥4.5:1 on cards, white-on-accent ≥3:1.

| id | family | name | bg / elev / elev2 | text / dim / faint | accent / bright / deep |
|---|---|---|---|---|---|
| ember | Ember | Midnight Ember (default) | #1b2026 #242b33 #2e3742 | #e8eaed #97a3b0 #64707d | #a63446 #c4576a #7c2434 |
| wine | Ember | Charcoal Wine | #171419 #211d25 #2c2731 | #ece8ef #a49cae #6f6779 | #94405f #b76282 #6a2a43 |
| cobalt | Deep Focus | Night Cobalt | #101722 #18222f #212e3f | #e6ecf4 #8fa2b8 #5d7086 | #3d72ad #6296cd #2a527e |
| paper | Deep Focus | Paper & Ink (light) | #f0ead8 #fdf6e3 #f5efdc | #1f2933 #52616f #7c8896 | #33557e #466992 #24405e |
| forest | Calm | Still Forest | #151b17 #1d2620 #27332b | #e7ece8 #95a89a #617568 | #4e8465 #6faa89 #375f49 |
| eucalyptus | Calm | Eucalyptus (light) | #ebeddb #fbf7e6 #f2f1de | #233029 #54675c #7e8f84 | #3d7a5c #548f70 #2b5741 |
| coral | Energy | Coral Drive | #1c1613 #27201b #332a23 | #efe9e3 #ab9d8f #786c5f | #c25a38 #e07e5b #8d3f25 |
| sunrise | Energy | Sunrise (light) | #f1e7cf #fcf4df #f4ebd3 | #33291d #6b5d49 #93866f | #b35317 #cd6e33 #833c0f |

Status colors: dark themes `good #3ecf8e / warn #f39c12 / danger #ff6b5e`
(coral uses warn `#f0b429`); light themes `good #17835a / warn #a06508 /
danger #c23f33`. Light borders/tree-lines/shadows use warm brown-tinted
rgba (e.g. paper: `rgba(60,48,16,.14)` border), not blue-grey.

Family blurbs shown in UI: Ember "Warmth with focus — the original" ·
Deep Focus "Blues that support sustained attention" · Calm "Restorative
greens, easy on the eyes" · Energy "Warm tones that lift alertness".

**Picker UI:** a row of 4 family chips; selecting one reveals its variant
chips, each **inline-styled with its own palette** (chip bg = theme card
color, dot = accent) so the chip IS the preview, light ones suffixed "☀︎".
Tapping a variant applies the theme to the whole app instantly and saves.
Selected variant gets an accent ring.

## 7. Screens & exact behaviors

### 7.1 Home tab ("Tasks") — the single list (no separate Today tab)
- Header: time-of-day greeting ("Good morning"), sub-line "Friday, July 11 ·
  3 open · 2 done today".
- Filter row: two picker chips only — `⬤ Category` and `# Tags` — each opens
  a bottom sheet. Tags sheet: **search input filtering the tag chips live** +
  multi-select toggle chips + Clear/Done buttons. Category sheet: in-use color
  swatches, multi-select. Selections apply **instantly** (list re-renders
  behind the open sheet); chips show counts ("Tags · 2") and active styling.
  Matching: OR within a kind, AND across kinds (pure function, unit-tested).
  Active filters switch the list to flat matches with parent labels.
- **"Your focus" section** at top: auto-picked short list — every overdue +
  due-today task always included, then best-scored tasks fill up to
  `focusLimit` (3/5/7). Scoring (pure, deterministic all day): overdue
  `100 + hours_overdue (cap 48)`; due today +80, tomorrow +55, ≤3d +35,
  ≤7d +15; `+priority×15`; staleness `+1.5/day since created (cap 21 days)`;
  has-reminder +10. Top-level picks render as full subtrees, deduped from the
  groups below; picked subtasks render flat with a parent label.
- Groups below: **Overdue / Today / Upcoming / Someday** (by due date;
  completed-but-not-yet-archived tasks keep their spot, greyed).
- Subtask tree: indented 34px with rounded-elbow **connector lines**
  (2px, `--tree-line`), chevron collapse/expand with a 280ms clip-reveal
  slide (grid-template-rows 0fr→1fr trick), progress chip "2/5" on parents.
- **Done section**: `<details>` "Done (N) ▾", one card per archived subtree,
  newest first, cap render ~30, plus **"Clear all (N)"** button → confirm
  sheet → bulk delete.
- Empty state: "All clear. Tap + to capture your first task." with an example
  quick-add string.

### 7.2 Task card
Grid: check circle | content | trailing controls (play button when
timer/breaks set; chevron when children). Content: optional parent-label line,
title (0.98rem/550, line-through + faint when done, card opacity 0.55), chip
row. Chip order: category dot · due · session countdown ("⏱ 12m left of 50m",
live) or timer ("⏱ 30m") · "high" · interval ("every 30 min · next in 12m",
live math from the same anchor logic as the scheduler).

**Gestures** (touch events on the card):
- Tap → edit sheet. Tap is armed/consumed correctly vs. gestures below.
- **Swipe right >90px** → open add-subtask sheet.
- **Swipe left** → card follows finger (clamped ±120px, `.dragging` class
  disables the transform transition while following) and on release past
  ~60px **parks at −84px** revealing a **circular 46px `--danger` trash
  button** behind it (fades in with drag progress, springs to full scale when
  parked — iOS Mail style). Tap trash: leaf → instant delete + toast;
  has-children → confirm sheet with subtask count. Works in EVERY section
  including Done. Only one card revealed at a time (module-level closer);
  tapping the parked card tucks it back (and must NOT open the editor —
  suppress the click). Card spring-back transition 200ms.
- **Hold 500ms** → haptic tick (navigator.vibrate 15ms) arms the card; then
  **swipe down >40px while still holding** → toggle subtree collapse.
- No archive gesture: **completing a task auto-moves its subtree to Done**
  after the animation (below), with Undo restoring both completion and
  archived state.

### 7.3 The check-off animation (the app's signature — get this right)
Complete: 12 bubbles converge on the check circle (colors = accent triplet
via CSS vars) → radial fill grows from center 260ms → white check pops in
240ms with spring `cubic-bezier(0.34,1.56,0.64,1)` → **cascade: every visible
descendant check runs the same fill+pop sequence, staggered 90ms
top-to-bottom, their cards greying as they land** → data flips for the whole
subtree → auto-archive → toast "Done (+N subtasks)" with **Undo**. Uncheck:
check scales out 140ms → fill shrinks 220ms → bubbles burst outward.
A global `--anim` multiplier scales all durations; honor
`prefers-reduced-motion` by skipping straight to the end state. Collapsed
(hidden) descendants just flip data — no animation needed.

### 7.4 Editor (bottom sheets)
**Bottom sheet** component: scrim, grabber, ✕ button; dismiss via scrim tap,
✕, or drag-down >110px — but drag-down must **ignore touches that start on
any control** (inputs, buttons, chips, wheels, switches, segments): on iOS,
2px of tap jitter otherwise moves the sheet and Safari swallows the tap.

**Add sheet** (from FAB): heading, one big **natural-language input**
(autofocused), live-parsed chip row below it showing what was understood, a
hint line, then the option toolbar, then "Add task". Parser understands:
weekday names ("friday"), "today"/"tomorrow", "jul 12", times ("5pm",
"17:30" — a bare past time rolls to tomorrow), intervals ("every 30m",
"every 2h"), "high/low priority", "#tag". Parsed chips have ✕ removers;
removing one (or manually editing that control) adds its type to a `cleared`
set the parser no longer overwrites.

**Edit sheet**: title field, same toolbar, "+ Add subtask (N so far)",
Delete (confirm w/ subtree count) + Save.

**Option toolbar** (accordion, one panel at a time): chips
`Date · Timing · Priority · Color · Tags · Notes`, each with an SVG icon and
a **live summary label** when set ("Jul 20 17:00" / "every 30m · 50m timer" /
colored dot / "#bills +2" / "Notes ●") plus `.set` (accent-soft) and `.open`
(accent border) states. **Bind chip taps on `touchend`** (12px/600ms slop,
preventDefault to kill the ghost click) — iOS drops plain clicks when its
keyboard is dismissing; plain `click` handles mouse.
- **Date panel**: native date + time inputs side by side. On tap call
  `input.showPicker()` (try/catch) — iOS often focuses without opening.
  On change: blur to release the focus highlight. Date only → all-day;
  date+time → exact; time only → today at that time. Give the inputs
  `min-height:46px` (iOS collapses empty date inputs).
- **Timing panel**: three switch rows — "Notify me every…" / "Task timer" /
  "Breaks (work/break cycle)" — each revealing **time wheels** when on, plus
  a conditional "Silence intervals during a session" switch when timer or
  breaks are on. Defaults on first enable: interval 30m, timer 30m, breaks
  25/5.
- **Wheels**: vertical scroll-snap columns of numbers, item height 36px,
  wheel height 180px (5 visible), with a thick (68px) highlight band. THE
  TRUTH LIVES IN `dataset.val`, not scrollTop (hidden panels zero their
  scroll; restore visual from the value when re-shown). Programmatic scrolls
  set a flag so scroll listeners ignore them. **The entire wheel row is a
  drag surface** (pointer events + setPointerCapture): a drag starting
  between/next to wheels drives the horizontally nearest wheel; **suspend
  `scroll-snap-type` during such drags** (mandatory snap re-quantizes every
  programmatic scrollTop and eats the deltas), restore after the smooth
  snap-back on release.
- **Priority**: 3-segment control. **Color**: ✕-none + 8 swatches.
  **Tags**: comma-separated input. **Notes**: textarea.

### 7.5 Calendar tab
Month grid (S M T W T F S), dots on days having open tasks, selected day's
tasks listed below using the same task card (complete/delete/subtask all
work), ‹ › month nav + "Today" jump. View state survives tab switches.

### 7.6 Settings tab
Cards: **Notifications** (platform pill: native/push/web preview; permission
status + enable button; Android exact-alarm row when applicable; quiet hours
two time inputs; "Test notification in 2 minutes" button; iOS no-sound
guidance row: "Your iPhone decides that: Settings → Notifications → Focus →
Sounds; silent switch and Focus modes also mute it") · **Appearance** (§6) ·
**Focus** (list size 3/5/7 segment) · **Backup** (Export = share/download
JSON; Import = file picker, validate, confirm "Replace everything with this
backup (N tasks)?") · **About** (version/build; battery-optimization warning
for Android).

## 8. Focus sessions

Play button on cards with timer/breaks → `session = {startedAt: now}`.
Session end (timer duration + interleaved breaks) computed, not stored;
sessions self-terminate on reconcile when time's up. Notifications during a
session: "Break time" / "Back to work" alternating at the work/break
boundaries, "Time's up" at the end. While a session runs with
`muteDuringSession`, interval nags for that task are skipped. Stop button
(same button, square icon) ends it.

## 9. Notification engine (pure core + platform glue)

Keep the planners **pure and unit-tested**; the platform glue consumes them.

- **Interval nags** — anchored to `reminder.startAt ?? createdAt` (NOT the
  due date), fire every `intervalMin` forever until completed or switched
  off. Plan a **rolling ~12h window** of individual exact alarms, ≤24 per
  task, ≤180 total (stay under Android's 500-alarm cap), earliest first,
  **quiet-hours filtered** (a "22:00–08:00" range that may cross midnight).
  Android notification actions: **✓ Done / Snooze 1h** (snooze sets
  `reminder.startAt = now+1h`).
- **Due alerts** — one-shot at exactly `due` ("Due now"); all-day tasks
  instead at **9:00 that morning** ("Due today"). **Not** quiet-hours
  filtered (the user chose the moment). Skip past/completed. Done action only.
- **Session events** — as in §8.
- **Notification id scheme**: `nid = taskId*100 + slot`; slots 0–23 nags,
  **70 due**, 80–99 session, 999001 test. Keeps ids stable & collision-free.
- **`reconcile()`** — THE sync primitive: cancel everything pending, then
  schedule the current truth. Idempotent, self-healing. Run on app launch,
  resume, and (debounced ~400ms) after any data change. Also expires
  finished sessions.

**Android delivery**: Capacitor LocalNotifications — channel importance 5,
exact alarms `allowWhileIdle`, action listener handles Done/Snooze then
reconciles + rerenders.

**iPhone delivery**: see §10 — same plan, different sink.

## 10. iOS push backend (required for background reminders on iPhone)

iOS gives home-screen PWAs **no local background alarms**; Web Push is the
only path, and `PushManager` exists **only after Add-to-Home-Screen**
(iOS 16.4+, no Apple Developer account needed). Architecture:

- **Client** (`webpush.js`): random deviceId UUID in localStorage;
  `ensureWebPushSubscription()` — MUST request Notification permission
  synchronously in the user's tap (an intervening await consumes iOS's
  transient activation), then subscribe with the VAPID public key and POST
  `/subscribe`; `syncWebPush(rows)` POSTs the full computed schedule.
  Service worker (`sw.js`): `push` → showNotification, `notificationclick` →
  focus/open the app. No fetch caching in the SW.
- **Server**: a **Cloudflare Worker + D1** (free tier covers it; cron
  triggers at 1-minute granularity — most free "serverless cron" can't do
  that). Tables: `subscriptions(device_id PK, subscription JSON, updated_at)`,
  `pending(device_id, nid, fire_at, title, body)` indexed on fire_at, and a
  ring-buffer `log`. Routes: `POST /subscribe` (upsert), `POST /sync`
  (**delete this device's rows, insert the new set** — idempotent replace,
  mirrors reconcile; log `dev=… rows=N due=N`), `POST /unsubscribe`,
  `POST /test` (single sentinel row 2min out), `GET /status` (public,
  no-secrets: counts, next fire, recent send/sync log — your remote
  debugger for "notification didn't arrive"). Cron: select rows
  `fire_at <= now`, send each, log per-send HTTP status, delete sent rows
  (single best-effort attempt — client resync self-heals), purge device on
  410/404.
- **⚠️ THE ENCRYPTION LESSON (cost days):** Apple's push service **silently
  accepts nothing but `aes128gcm`** (RFC 8291). The legacy `aesgcm` encoding
  "sends" fine and never arrives. Use a library that does aes128gcm on
  Workers (e.g. `web-push-browser`) and verify with an RFC 8291 round-trip
  test before blaming anything else.
- VAPID: generate one keypair; private key as a Worker secret (JWK),
  public key as a client constant.

## 11. Update delivery (stale clients WILL bite you — build this early)

- **Web/PWA**: iOS home-screen apps run stale code for days. Fix: CI writes
  `version.json` (`{"build":"<commit sha>"}`) into the deploy; the app fetches
  it (`cache:'no-store'`) on boot and every visibilitychange→visible, and
  `location.reload()`s once when it changes.
- **Android**: APKs can't hot-update. On launch (native only), compare the
  installed versionCode against the newest release (GitHub releases API) and
  toast "Update available: v1.0.N — Get it" linking the download.
- Rule of thumb learned the hard way: when the owner says "feature X doesn't
  work," **first check they're running current code.**

## 12. CI/CD roadmap

- **Pages workflow**: on push — publish `www/` (plus the version.json stamp)
  to Pages.
- **APK workflow**: on push — `npx cap sync android`, Gradle release build
  signed with a **self-signed keystore COMMITTED to the repo** (personal
  sideloaded app: the key protects nothing, but a CONSTANT key is what lets
  updates install over old builds with data intact — **never regenerate
  it**), `versionCode = workflow run number`, upload the APK to a
  **rolling `latest` release** with a **VERSIONED filename**
  (`focus-v1.0.<run>.apk`) and delete older assets after publishing — every
  download then saves as a distinct file on the phone, so a stale copy in
  Downloads can never be mistaken for (or reinstalled as) the new build.
  This was learned the hard way: identical filenames caused users to
  reinstall old `focus (1).apk` copies and report "the update didn't work."
- **Worker workflow**: on pushes touching the worker — wrangler deploy, with
  idempotent D1 create/schema steps. Secrets: Cloudflare account id + API
  token + VAPID private key.

## 13. Build order (with acceptance gates)

1. **Scaffold + CI first**: repo, `www/` skeleton with tabbar/FAB/theme
   tokens, Capacitor android project, all three workflows green, APK
   installs, Pages serves. *Gate: owner can install & open both.*
2. **Data + home list**: store/model/tests, task cards, editor sheets
   (title/date/priority/color/tags/notes), check-off with animation (single
   task), Done section. *Gate: full CRUD on phone, zero console errors.*
3. **Subtasks + gestures**: tree render, chevrons, connector lines, hold-swipe
   toggle, swipe-right subtask, swipe-left trash reveal, cascade completion,
   auto-archive + Undo, Clear all.
4. **Quick-add parser + focus list + calendar** (pure functions + tests
   first).
5. **Timing features**: wheels, interval nags on Android (reconcile,
   actions, quiet hours), due alerts, sessions with play button + live chips.
6. **iOS**: manifest/icons/meta, then the Worker backend + web push path +
   `/status` diagnostics. *Gate: test push lands on a real iPhone with the
   app closed.*
7. **Themes + settings polish + backup.**
8. **Update delivery (§11) + final E2E pass.**

## 14. Testing requirements

- **Unit** (`node --test`, no DOM): parser, scoring, filter matcher,
  reminder/due/session planning (freeze `now`), quiet-hours math incl.
  midnight crossing, model subtree ops, theme token completeness + WCAG AA
  contrast (compute luminance; light AND dark). Target: the finished
  original has ~78 of these.
- **E2E** (Playwright, 412×915, hasTouch): seed via the model in
  `page.evaluate` (remember the debounced save — wait ~900ms before reload),
  assert: tab structure, focus section, picker filtering incl. live search,
  swipe-left park + delete (dispatch synthetic TouchEvents), cascade classes
  appearing staggered, subtree landing in Done, Clear all, each theme
  applying (check computed `--bg`) and surviving reload, editor chips
  toggling via touch, **zero console errors everywhere**.
- Mock the push server with request interception; force
  `Notification.permission` via defineProperty to test the sync path.

## 15. Pitfall checklist (every one of these was a real bug)

1. Apple push = **aes128gcm only**; `aesgcm` fails silently. (§10)
2. iOS Notification permission request must be the FIRST await in the tap
   handler.
3. Sheet drag-to-dismiss stealing taps on controls → dead buttons on iOS.
4. iOS drops clicks when its keyboard dismisses mid-tap → bind sheet-toolbar
   taps on touchend with slop check + preventDefault.
5. iOS date inputs focus without opening the picker → call `showPicker()`.
6. `scroll-snap-type: mandatory` eats programmatic scrollTop deltas → suspend
   during custom drags.
7. Hidden panels zero their scroll positions → keep wheel values in data
   attributes, restore visuals on reveal.
8. Text selection on long-press ruins drag gestures → `user-select:none` +
   `-webkit-touch-callout:none` on body, re-enable on inputs.
9. Stale PWA/APK clients (§11) — build the version checks before you need
   them.
10. Debounced saves: tests that mutate then immediately reload lose data.
11. Never regenerate the Android keystore; never let users uninstall without
    exporting (localStorage IS the database).
12. Re-render must preserve scroll/open-details or the app "flickers reset"
    every 30s.
13. Grouping by completion state moves cards around mid-animation — group by
    due date and let completed cards keep their spot until archived.

## 16. Working with the owner

They communicate by **voice-to-text** — expect typos and stream-of-thought;
read generously and restate what you understood before building. Give direct
answers first, detail after. Everything happens from their phone (see the
⚠️ section at the top — reread it whenever you're about to ask them to do
something). They test on a real Android phone via the release APK; the
iPhone user is a friend they share the Pages URL with. Ship in small
verified rounds with screenshots. **Do not restyle the app or "improve" the
design — match this blueprint.** When something doesn't work on-device,
check client staleness and the worker `/status` log before touching code.
