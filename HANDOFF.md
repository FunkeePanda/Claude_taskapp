# Focus — Complete Project Handoff

**You are taking over a finished, live, in-production task app.** This document
is your single source of truth: what the app is, how every feature behaves, why
each design decision was made, where everything lives, and the hard-won platform
lessons that cost real debugging time. Read it fully before changing anything.
The owner considers the current design and UX **correct** — your job is to
extend and fix, not restyle or re-architect.

---

## 1. What this is

**Focus** — a personal task manager built for two phones:
- **Android**: a signed, sideloaded APK (Capacitor 7 wrapping the web app).
- **iPhone**: an installable home-screen PWA (same code, served from GitHub Pages).

Owner: GitHub `FunkeePanda`, repo `FunkeePanda/Claude_taskapp`,
working branch `claude/mobile-task-manager-app-0roqsf`.

Live endpoints:
- Web/PWA: `https://funkeepanda.github.io/Claude_taskapp/`
- Android APK (rolling release): `https://github.com/FunkeePanda/Claude_taskapp/releases/latest` → `focus.apk`
- Push backend (Cloudflare Worker): `https://focus-push.funkeepanda.workers.dev`
  (`GET /status` is a public no-secrets diagnostics endpoint — use it whenever
  "notification didn't arrive" comes up)

**Core philosophy (do not violate):**
- **No build step.** Plain ES modules, no bundler, no framework, no npm deps in
  the web app. `www/` is served verbatim. Code style: small modules, pure logic
  separated from DOM glue, comments explain *why* not *what*.
- **No accounts, no analytics.** All task data lives on-device in localStorage.
  The only server is the push relay, which sees only reminder titles/times.
- **Everything ships from CI.** The owner does not run local toolchains; every
  change lands via git push → GitHub Actions → Pages/Release/Worker.

## 2. Repository map

```
www/                     the entire app (served verbatim by Pages, bundled by Capacitor)
  index.html             shell: tabbar (Tasks/Calendar/Settings), #view, #fab, sheet/toast roots
  css/main.css           ALL styling incl. theme tokens in :root (see §6)
  css/animations.css     keyframes: check fill/pop, bubbles, stagger entry, collapse
  js/app.js              boot: router, rerender contract, 30s chip tick, version checks
  js/store.js            localStorage persistence, debounced save, backup copy, migrations
  js/model.js            task CRUD, subtree ops (children/descendants/progress/archive)
  js/parser.js           natural-language quick-add parsing
  js/focus.js            pure scoring + todayList picker
  js/filter.js           pure multi-select tag/color matcher
  js/reminders.js        notification engine: pure planners + platform glue (see §7)
  js/webpush.js          iOS Web Push client (deviceId, subscribe, /sync)
  js/themes.js           8 theme presets + applyTheme() (see §6)
  js/native.js           Capacitor-vs-web abstraction (isNative, plugin mocks)
  js/dates.js            calendar month math
  js/ui/components.js    shared UI: taskCard (gestures+animations), sheets, toast, chips
  js/ui/tasks.js         the home view (merged list, focus section, pickers, Done)
  js/ui/calendar.js      month grid + day task list
  js/ui/editor.js        add/edit bottom sheets (NL input, chip toolbar, wheels)
  js/ui/settings.js      permissions, quiet hours, themes UI, backup, about
  sw.js                  service worker: push display + notificationclick only (no fetch caching)
  manifest.webmanifest   PWA manifest (relative start_url/scope for the Pages subpath)
worker/                  Cloudflare Worker push backend
  src/index.js           routes: /subscribe /sync /unsubscribe /test /status + 1-min cron
  schema.sql             D1: subscriptions, pending, log (all IF NOT EXISTS, safe re-run)
  wrangler.toml          D1 binding + cron trigger
android/                 Capacitor Android project. RARELY touched.
  app/keystore/app.keystore  committed self-signed key — NEVER regenerate (see §9)
test/                    node --test suites (78 tests) — pure logic only, no DOM
.github/workflows/
  pages.yml              www/ → gh-pages; writes version.json build stamp
  android-apk.yml        signed APK → rolling "latest" release; versionCode = run_number
  worker-deploy.yml      wrangler deploy on worker/ changes
HANDOFF.md               this file
```

## 3. Data model (store.js + model.js)

One versioned document in `localStorage['focus.data.v1']`, with last-known-good
backup in `focus.data.v1.bak`. `save()` debounces 250ms; **tests and E2E must
wait ~900ms after mutating before reload**. Migrations: `load()` backfills any
field added since v1 (pattern: `if (t.field === undefined) t.field = default`).

Task fields:
```js
{
  id,                    // int, monotonic (meta.nextId)
  title, notes,
  due,                   // epoch ms | null
  allDay,                // true = date-only (internally stamped 23:59)
  priority,              // 0 low / 1 normal / 2 high
  tags,                  // string[] (lowercase, no #)
  color,                 // category color hex from editor.js COLORS | null
  reminder,              // { intervalMin, startAt|null } | null — "notify me every…"
  timer,                 // { durationMin } | null — how long the task should take
  breaks,                // { workMin, breakMin } | null — pomodoro cycle
  muteDuringSession,     // default true — silence interval nags while session runs
  session,               // { startedAt } | null — a running focus session
  parentId,              // nesting (arbitrary depth); orphan guard renders as top-level
  collapsed,             // UI: subtree hidden
  archived,              // lives in the Done section (whole subtree moves together)
  createdAt, completedAt,
}
```
Settings: `{ quietStart:'22:00', quietEnd:'08:00', focusLimit:5, theme:'ember' }`.

## 4. Feature inventory & exact behaviors

### Home tab ("Tasks") — js/ui/tasks.js
- Greeting header ("Good morning · Friday, July 11 · 3 open · 2 done today").
- **"Your focus" section**: auto-picked short list from `todayList()` (focus.js):
  every overdue + due-today task always included, then best-scored fill up to
  `focusLimit` (3/5/7, set in Settings). Scoring = urgency (overdue grows for
  48h) + priority×15 + staleness + reminder bonus. Deterministic all day.
  Top-level picks render as full subtrees and are deduped from the groups
  below; picked subtasks show flat with a parent label.
- Groups below: **Overdue / Today / Upcoming / Someday** (completed tasks keep
  their spot greyed until they move to Done).
- **Done section**: collapsed `<details>`, one card per archived subtree,
  newest first, with **"Clear all (N)"** → confirmSheet → deletes all.
- **Filters**: two picker chips (no inline clutter):
  - `⬤ Category` → sheet of in-use color swatches, multi-select.
  - `# Tags` → sheet with **live search input** + all tags as toggle chips.
  - Both apply instantly (list re-renders behind the open sheet), chips show
    active count ("Tags · 2"), matching = OR within a kind, AND across kinds
    (pure logic in filter.js). Active filter switches list to flat matches.

### Task cards — js/ui/components.js `taskCard()`
Grid: check circle | content (parent label, title, chips) | play button + chevron.
Chips (in order): category dot, due ("Today 3:38 AM"/"Overdue 2h"), live session
countdown ("⏱ 12m left of 50m") or timer ("⏱ 30m"), priority "high", interval
("every 30 min · next in 12m"). **No inline tag chips** — tags live in the picker.

Gestures (touch):
- **Tap** → edit sheet. **Swipe right >90px** → add subtask sheet.
- **Swipe left** → card follows finger and **parks at −84px** over a revealed
  circular red trash button (iOS Mail pattern; button fades in with drag,
  springs to scale 1 when parked). Tap trash: leaf deletes instantly + toast;
  parent asks `confirmSheet("Delete "X" and N subtasks?")`. Works in every
  section including Done. Only one card revealed at a time; tapping the card
  or touching elsewhere tucks it back. Works via module-level `closeOpenReveal`.
- **Hold 500ms** (haptic tick) **then swipe down while holding** → toggle
  subtree collapse. Chevron button does the same.
- The card has `transition: transform 0.2s` for the spring; a `.dragging`
  class disables it during finger-follow.

### Completion — `completeWithAnimation()` in components.js
Check tap → bubbles converge (12, themed via CSS accent vars) → fill grows →
white check pops → **cascade: every visible descendant check runs the same
fill sequence staggered 90ms top-to-bottom** → whole subtree data-flips
(`completeWithDescendants`) → **auto-archives to Done** → toast with **Undo**
(un-completes flipped ids AND un-archives the subtree). Uncheck reverses
(fill out, bubbles burst) and pulls the task back out of Done.
Respect `--anim` multiplier and `prefers-reduced-motion` (skip straight to state).

### Editor — js/ui/editor.js
- **Add sheet**: NL-first. One input parsed live (parser.js) into removable
  chips. Understands: `friday`, `tomorrow 5pm`, `jul 12`, `every 30m`/`every 2h`,
  `high priority`, `#tag`, bare times (past times roll to tomorrow). Manual
  edits to any control add its type to a `cleared` set — the parser stops
  touching those.
- **Edit sheet**: title field + same toolbar + Add subtask / Delete / Save.
- **Chip toolbar accordion** (one panel open at a time):
  Date · Timing · Priority · Color · Tags · Notes. Chips show live summaries
  when set ("Jul 20 17:00", "every 30m · 50m timer", colored dot, "#bills +2",
  "Notes ●") and get `.set`/`.open` styling.
- **Date panel**: native date+time inputs. Tap force-opens the picker via
  `showPicker()`; focus ring (accent border + soft glow) persists until blur
  or a selection (change → blur). Date only = all-day; time only = today.
- **Timing panel**: three switches — "Notify me every…" (interval wheels),
  "Task timer" (duration wheels), "Breaks" (work/break wheels) + conditional
  "Silence intervals during a session" switch.
- **Wheels**: scroll-snap columns, 36px items. **True value lives in
  `dataset.val`, never scrollTop** (hidden panels zero their scroll).
  Programmatic moves set `dataset.prog` so scroll listeners ignore them.
  The whole `.wheel-row` is a drag surface (`bindRowDrag`, pointer events +
  capture): drags between wheels drive the horizontally nearest wheel;
  **scroll-snap is suspended during the drag** (`scrollSnapType='none'`) and
  restored after the smooth snap-back, else mandatory snap eats the deltas.
- **iOS tap reliability (`bindTap`)**: option chips toggle on `touchend`
  (with 12px/600ms slop check + preventDefault against ghost clicks), because
  iOS drops the click when the keyboard dismisses mid-tap. Keep this pattern
  for any new tappable row inside sheets.

### Sheets, toasts — components.js
`openSheet(html)` bottom sheet: scrim tap, ✕, or drag-down >110px dismiss.
The drag-down **ignores touches starting on any control**
(`.opt-panel, .opt-row, .wheel*, input, textarea, select, button, .switch, .segment`)
— required for iOS tap reliability, don't narrow it. `confirmSheet(msg, label)`
promise-based destructive confirm. `toast(msg, {actionLabel, onAction})`.

### Calendar — js/ui/calendar.js
Month grid, dots on days with open tasks, tap day → its tasks (taskCard with
same complete/delete/subtask handlers), Today jump button.

### Sessions
Play button on cards with timer/breaks. `sessionEndsAt` accounts for breaks
interleaving. Sessions self-end when time is up (checked in reconcile).
While a session runs and `muteDuringSession`, interval nags are skipped.

### Settings — js/ui/settings.js
- Platform pill (native/push/web), permission status+request, exact-alarm row
  (Android 12+), quiet hours, iOS "no sound" guidance row.
- **Appearance**: family chips (Ember/Deep Focus/Calm/Energy) → variant chips
  **painted in their own palette** (chip = live preview) → tap applies
  instantly (`applyTheme`) + persists. Current variant ring-marked.
- Focus list size (3/5/7). Export/Import JSON backup (validate before replace).
- Test notification button (2-min lockscreen test, native or push).
- About: version/build. iOS-detection: UA + `maxTouchPoints` for iPadOS.

## 5. Notifications (the crown jewels — §7 for architecture)

Three kinds, all planned by **pure exported functions** in reminders.js
(unit-tested; keep them pure):
1. **Interval nags** — `occurrencesFor/planAll`: "every N min" anchored to
   createdAt or snoozed startAt (NOT due). Rolling 12h window, ≤24/task,
   ≤180 total, quiet hours filtered. Android actions: ✓ Done / Snooze 1h.
2. **Due alerts** — `dueNotification`: one-shot at the exact chosen date+time
   ("Due now"); all-day tasks at 9:00 that morning ("Due today"). Deliberately
   NOT quiet-hours filtered (user picked the moment). Done action only.
3. **Session events** — `sessionNotifications`: break time / back to work /
   time's up.

**nid slot scheme** (notification id = taskId×100 + slot): nags 0–23,
**due 70**, sessions 80–99, test 999001. Slot 70 is how you spot due alerts
in the worker log (`nid % 100 === 70`).

## 6. Design system & themes

**The owner loves the current design. Preserve it.** Dark navy + maroon,
16px radius cards, Inter font, layered elevation, subtle borders.

All colors flow through `:root` CSS custom properties (css/main.css):
`--bg, --bg-elev, --bg-elev-2` (3-step elevation ladder: page → card → nested),
`--text, --text-dim, --text-faint` (3-step text ramp),
`--accent, --accent-bright, --accent-deep, --accent-soft` (accent quartet),
`--good, --warn, --danger, --border, --tree-line, --shadow, --accent-shadow`.
**Never hardcode a color in a component; add a token.** Bubbles/FAB shadow
already read tokens.

**themes.js**: 8 presets across 4 psychology families, each `{id, family,
name, dark, tokens}` covering EVERY token (unit test enforces completeness +
WCAG AA contrast — run it after any palette change):
- **Ember** (default, warmth+focus): `ember` "Midnight Ember" — THE original,
  values must stay byte-identical to main.css defaults; `wine` "Charcoal Wine".
- **Deep Focus** (blue = sustained attention): `cobalt` dark; `paper`
  "Paper & Ink" light.
- **Calm** (green = restorative): `forest` dark; `eucalyptus` light.
- **Energy** (warm = alertness): `coral` dark; `sunrise` light.
- **Light themes use shell-white/manila surfaces, NEVER pure white** —
  explicit owner request ("the white is really powerful"). e.g. paper cards
  are `#fdf6e3` on `#f0ead8`.
`applyTheme(id)` sets inline vars on `<html>`, flips `color-scheme`, and
updates `<meta name="theme-color">`. Applied at boot from settings.

Category colors (per-task, separate from themes) — editor.js `COLORS`:
rose #C4576A · ember #D96C47 · amber #D9A441 · moss #7FA65A · teal #4A9E8F ·
steel #5B84A8 · violet #8A6FB8 · slate #8B97A3.

Signature animation timings: check fill 260ms, pop 240ms spring
`cubic-bezier(0.34,1.56,0.64,1)`, cascade stagger 90ms, subtree slide 280ms,
stagger entry per-card delay via `--i`.

## 7. Platform architecture (why there are two delivery paths)

`native.js` exports `isNative` (Capacitor Android) — the single switch used
everywhere. Web preview without push gets mock no-ops.

**Android (native)**: `@capacitor/local-notifications` exact alarms, entirely
on-device. `reconcile()` = cancel ALL pending, reschedule current truth
(idempotent, self-healing; runs on boot, resume, and any data change,
debounced 400ms).

**iPhone (PWA)**: iOS gives home-screen web apps **no local background
alarms** — Web Push is the only path, and Push API only exists once installed
to home screen (iOS 16.4+; no Apple Developer account needed). So:
`webpush.js` (deviceId UUID in localStorage, VAPID subscribe, POST full
schedule to `/sync`) → Cloudflare Worker + D1 (`subscriptions`, `pending`,
`log`) → cron `* * * * *` sends due rows via **web-push-browser** with
**aes128gcm** and deletes them (single best-effort attempt; client resync
self-heals) → `sw.js` shows it. 410/404 = dead device, purge. Same
`reconcile()` planning, different sink. Secrets: `VAPID_PRIVATE_KEY` is a JWK
Worker secret; public key is a constant in webpush.js. Worker deploy needs
repo secrets `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`.

**CRITICAL LESSON**: Apple's push service **silently rejects the legacy
`aesgcm` encoding** — pushes "send" but never arrive. Must be `aes128gcm`
(RFC 8291). This was debugged the hard way; web-push-browser does it right.
If pushes stop arriving: `GET /status` → `recent` log shows per-send HTTP
status (201 = accepted by Apple/Google) and `sync` rows show what devices
upload (`dev=… rows=N due=N`).

**Privacy note the owner accepted**: reminder title + fire time transit
Cloudflare for iOS. Nothing else leaves the device.

## 8. Update delivery (stale-cache wars — real recurring pain)

- **Web/PWA**: iOS home-screen apps run stale code for DAYS. Fixed:
  `pages.yml` writes `version.json` (`{"build": GITHUB_SHA}`); app.js polls it
  (`cache:'no-store'`) on boot + every `visibilitychange`→visible and
  `location.reload()`s once when it changes. Don't remove this.
- **Android**: APK can't hot-update. app.js (native only) compares
  `App.getInfo().build` (= versionCode = APK workflow run number) against the
  latest release name via GitHub API and toasts "Update available → Get it".
- When a user reports "feature X doesn't work", **first question: are they on
  current code?** Check `/status` sync log (iOS) or Settings→About build (Android).

## 9. CI/CD (everything ships from push)

- `pages.yml`: any push to `main`/`claude/**` → `www/` (+version.json) →
  gh-pages branch → Pages. ~1–2 min.
- `android-apk.yml`: same triggers → `npx cap sync android` → gradle release →
  uploads `focus.apk` to the **rolling `latest` release** (stable download
  URL). `VERSION_CODE`/`VERSION_NAME 1.0.<run_number>`.
  **`android/app/keystore/app.keystore` is committed on purpose** (personal
  sideloaded app; a CONSTANT key is what lets updates install over old builds
  with data intact). **Never regenerate/rotate it** — users would have to
  uninstall (which wipes localStorage tasks). Password default in build.gradle.
  NOTE: releases replace the asset in-place; a download attempted mid-swap
  yields a corrupt file → Android's "App not installed".
- `worker-deploy.yml`: pushes touching `worker/` → wrangler deploy (+idempotent
  D1 create/schema/secret steps).

## 10. Testing & verification workflow

- **Unit**: `node --test test/*.test.js` — 78 tests, pure logic only (parser,
  focus scoring, reminders/due math, sessions, dates, model, filter, themes
  token-completeness + WCAG contrast, webpush base64). Add tests for any new
  pure function; keep DOM out.
- **E2E pattern**: serve `www/` with any static server, drive with Playwright
  (mobile viewport 412×915, `hasTouch:true`). Seed via
  `await import('./js/model.js')` in `page.evaluate`, **wait ~900ms for the
  debounced save**, reload, assert. Synthesize swipes by dispatching
  TouchEvents; check zero console errors ALWAYS (ignore the dev-only
  version.json 404). Mock the push server with `page.route('**/sync')` and
  `Object.defineProperty(Notification,'permission')` to test reconcile.
- **What can't be verified remotely**: a real notification on a real phone.
  For iOS: worker `/status` log is your proxy. For Android: build must be
  installed by the owner.

## 11. Known quirks & etiquette (cost hours each — don't relearn)

1. `body` has `user-select:none` + `-webkit-touch-callout:none` (Safari needs
   both); inputs/textareas re-enable selection. Don't remove.
2. `rerender()` (app.js) preserves scroll + open `<details>` — views must be
   re-render-safe at any time (30s chip tick calls it; paused while a sheet
   is open so re-renders never eat edits).
3. Task-card grouping ignores completion so checked tasks keep their spot
   until auto-archive moves them.
4. Sheet drag-to-dismiss must never claim touches on controls (§4 Sheets).
5. Wheels: value in `dataset.val`; suspend scroll-snap while dragging.
6. Completed→Done is automatic (with Undo); swipe-left is delete-reveal ONLY.
7. Import validates before replacing; export is the only backup — remind the
   owner to export before anything risky. **Uninstalling the APK or removing
   the PWA wipes all tasks.**
8. The owner communicates by voice-to-text: expect typos, read generously,
   confirm understanding by restating, and when asked a question give the
   direct answer first.
9. Ask before restyling anything — the current look is a hard requirement.

## 12. Current state & open threads

- All shipped and live as of this handoff: merged single-list home,
  tag/category pickers, swipe-to-delete + Clear All, cascade completion,
  8 themes, due-time notifications, iOS tap fixes, self-updating web app,
  APK update toast, worker sync logging.
- **Open at handoff**: owner (Android) was struggling to download/install the
  latest APK ("App not installed" — likely corrupt download from mid-swap or
  a stale copy in Downloads; walk them through deleting old focus.apk files
  and re-downloading; signature/versionCode conflicts were ruled out).
  Owner has not yet confirmed a due-time notification arriving on-device.
- **Requested future feature**: recurring/repeatable tasks ("we'll figure
  that out later") — likely a `repeat` field + completion spawning/resetting
  the next occurrence; design not started.
- Task data lives only on the owner's phones. There is no server copy.
