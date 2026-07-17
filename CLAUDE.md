# Focus — ground rules for working in this repo

Read this before making changes. Product ground rules first, then the actual
architecture as it exists in the code today.

## What this app is

**Focus** is a local-first task manager, mobile-first, for people whose
brains make ordinary task apps actively harder to use: ADHD, autism, OCD,
anxiety, depression, chronic fatigue, and productivity-hindered users
generally.

Three pillars drive every decision:
1. **Aggressive, persistent reminders** — nagging that doesn't politely give
   up after one notification.
2. **Deep customization** — nothing about how the app looks, sounds, or
   behaves should be a one-size-fits-all default the user is stuck with.
3. **Full data ownership** — the user's tasks are theirs, on their device,
   full stop.

## Stack (do not change without asking)

Plain JavaScript ES modules + HTML + CSS. **No framework, no build step, no
bundler.** `www/` is the entire app and is capable of running as a bare
static site.

- **Android** = the same `www/` code wrapped in **Capacitor 7**
  (`capacitor.config.json`, `android/`), built to a **signed APK via
  Gradle**, distributed as a sideloaded APK on a rolling GitHub Release (not
  the Play Store).
- **iOS** = the same `www/` code as an installable **PWA**, hosted on
  **GitHub Pages**, installed via Safari's Add to Home Screen (this is what
  unlocks the Push API on iOS — no Apple Developer Program needed,
  deliberately avoided).
- **CI = GitHub Actions**, three workflows, all on push:
  `pages.yml` (publishes `www/` + a `version.json` build stamp the PWA polls
  so it can self-update — important, since iOS home-screen apps otherwise
  run stale code for days), `android-apk.yml` (signed release APK, published
  under a **versioned filename** so a stale download can never masquerade as
  the latest build), `worker-deploy.yml` (deploys the Cloudflare Worker on
  changes under `worker/`).
- **The owner works entirely from their phone** — no local toolchain, no
  terminal. Every change ships via push → CI → live download/deploy; never
  propose a step that requires a computer.

## Data: on-device only, one narrow exception

**localStorage on the device. No database, no accounts, no cloud sync.**
Never add a feature that requires a server to hold or sync task data.

The **one** deliberate exception: the existing **Cloudflare Worker**
(`worker/`), which exists solely to relay iOS push reminders (iOS has no
local background-alarm API for web apps — Push is the only way to notify
with the app closed). It may only ever hold a **reminder title and firing
time**. It must never hold task data — no notes, no tags, no subtasks,
nothing beyond what's needed to render one notification. **Do not expand its
scope.** If a feature idea would require the Worker to know more about a
task than that, the feature needs a different design, not a bigger Worker.

## Platform reality — don't propose what the platform can't do

- **iOS PWA cannot do widgets, and cannot do on-device scheduled
  notifications.** There is no local alarm API for installed web apps on
  iOS — reminders only exist because of the Worker + Web Push path above.
  Any iOS feature idea that assumes local scheduling or a home/lock-screen
  widget is a non-starter under the current architecture without first
  reversing the "PWA, not a native App Store app" decision (made explicitly
  to avoid the $99/yr Apple Developer Program — see `BLUEPRINT.md`).
- **Android widgets are possible but expensive.** They require genuinely
  native code — a Kotlin/Java `AppWidgetProvider` added to the `android/`
  Capacitor project, entirely outside the web-view bridge that the rest of
  this app lives in. Treat as high cost; don't build casually as a side
  effect of another feature.

## Design rules

- **No shame mechanics by default.** Overdue states, streaks, red badges —
  all of these need **gentle** and **hidden** display modes as toggles, not
  just a firm/harsh default. Some users want firm deadlines; some are
  actively harmed by them. Build the toggle in the same change that adds the
  mechanic — don't ship harsh-only "for now."
- **Low visual clutter, minimal animation/sound by default.**
  *Known tension to resolve deliberately, not silently*: the existing
  task-completion animation (bubbles converge → fill → check pops → cascades
  through subtasks) is a signature piece of this app the owner explicitly
  loves and asked to be preserved. It predates this rule and is arguably
  exactly what the rule is about. Don't rip it out and don't quietly exempt
  it — the right move is a dedicated settings toggle (independent of the
  OS-level `prefers-reduced-motion` check the code already honors) so users
  who want calm get it without the owner losing the animation. Flag this to
  the user before touching it.
- **Every notable feature is a user toggle.** Keep using the simple
  feature-flag pattern already in Settings (see below) — it costs almost
  nothing to extend and is exactly the infrastructure this rule asks for.

## Solo dev

Prefer simple, dependency-free implementations. This repo has no framework,
no build step, no state-management library, and no runtime npm dependencies
in the client app — keep it that way unless a specific feature makes it
genuinely impossible.

---

## Actual current file structure

```
www/                       the entire app (served verbatim by Pages, bundled by Capacitor)
  index.html                shell: tabbar (Tasks/Calendar/Settings), #view, #fab, sheet/toast roots
  manifest.webmanifest       PWA manifest (relative start_url/scope for the Pages subpath)
  version.json                written by CI, not committed — build-stamp the PWA polls
  css/
    main.css                 all styling incl. theme tokens in :root
    animations.css            keyframes: check fill/pop, bubbles, stagger entry, collapse
  js/
    app.js                    boot: router, rerender contract, 30s chip tick, update checks
    store.js                  localStorage persistence, debounced save, backup copy, migrations
    model.js                  task CRUD, subtree ops (children/descendants/progress/archive)
    parser.js                 natural-language quick-add parsing
    focus.js                  pure scoring + todayList picker
    filter.js                 pure multi-select tag/color matcher
    reminders.js               notification engine: pure planners + platform glue
    webpush.js                 iOS Web Push client (deviceId, subscribe, /sync)
    themes.js                  8 theme presets + applyTheme()
    native.js                  Capacitor-vs-web abstraction (isNative, plugin mocks)
    dates.js                   calendar month math
    vendor/capacitor-core.js   vendored Capacitor runtime (no npm dependency at request time)
    ui/
      components.js            shared UI: taskCard (gestures+animations), sheets, toast, chips
      tasks.js                 home view (merged task list, focus section, pickers, Done)
      calendar.js               month grid + day task list
      editor.js                 add/edit bottom sheets (NL input, chip toolbar, wheels)
      settings.js                permissions, quiet hours, themes UI, backup, about
  sw.js                       service worker: push display + notificationclick only
worker/                     Cloudflare Worker push backend (the one server component)
  src/index.js                routes: /subscribe /sync /unsubscribe /test /status + 1-min cron
  schema.sql                   D1: subscriptions, pending, log (all IF NOT EXISTS, safe re-run)
  wrangler.toml                 D1 binding + cron trigger
android/                    Capacitor Android project. Rarely touched directly.
  app/keystore/app.keystore    committed self-signed key — NEVER regenerate (breaks updates)
test/                       node --test suites, pure logic only, no DOM (85 tests)
.github/workflows/
  pages.yml                    www/ → gh-pages; writes version.json build stamp
  android-apk.yml               signed APK → versioned filename on a rolling GitHub Release
  worker-deploy.yml             wrangler deploy on worker/ changes
CLAUDE.md                   this file
ROADMAP.md                  candidate features, not yet implemented
README.md                   phone-centric install/usage instructions
BLUEPRINT.md                a from-scratch build spec written for a different AI/project —
                              point-in-time snapshot of intent, not a living doc; CLAUDE.md is
                              the source of truth for what the code does right now
```

## Modules and how they fit together

**State management: no library, one in-memory singleton.**
`store.js` holds a single module-level `doc` object (the whole task
document), lazily loaded from `localStorage` on first access. All mutation
goes through `model.js` (`createTask`, `updateTask`, `deleteTask`,
`setCompleted`, `setArchived`, `completeWithDescendants`, etc.), which
mutate `doc` directly and call `save()`. `save()` debounces writes ~250ms and
notifies subscribers via a tiny pub-sub (`onChange(fn)`). There is no
virtual DOM: views re-render by rebuilding `innerHTML` from template
literals; `app.js`'s `rerender()` is the single entrypoint, invoked on data
change (debounced 400ms), on tab switch, and on a 30-second tick for live
countdowns (paused while a sheet is open so it never clobbers an
in-progress edit). Scroll position and open `<details>` are preserved
across a rerender by hand.

**"Database": a single JSON document in localStorage.**
Key `focus.data.v1`. No IndexedDB, no SQL, no ORM. A `.bak` copy of the
prior value is written before every overwrite as a corruption guard. Schema
evolution is a load-time backfill: `load()` sets a default for any field
missing since v1 (`if (t.field === undefined) t.field = default`) — this is
the pattern to extend for any new task field. `exportJSON()`/`importJSON()`
in `store.js` serialize/restore the entire document — see ROADMAP.md, this
is already fully built and wired into Settings.

**Notifications — pure planners + two delivery backends.**
`reminders.js` computes *what* should fire and *when* as pure, unit-tested
functions (`occurrencesFor`, `planAll`, `dueNotification`,
`sessionNotifications`) given task state and the current time — no side
effects. `reconcile()` is the sync primitive: cancel everything currently
scheduled, reschedule from the freshly computed truth. Idempotent,
self-healing, called on load/resume/data-change. Delivery branches on the
single `isNative` flag (`native.js`, from Capacitor's platform detection):
- **Android**: `@capacitor/local-notifications` — real on-device exact
  alarms. A rolling ~12h window of individual scheduled notifications
  (Android has no native "repeat every N minutes" primitive), capped at
  24/task and 180 total (`MAX_PER_TASK`/`MAX_TOTAL` in `reminders.js`) to
  stay under the OS's pending-alarm ceiling. Notification actions (✓ Done,
  Snooze) are wired and functional.
- **iOS**: Web Push, via `webpush.js` (client) talking to the Cloudflare
  Worker described above. The client posts its full computed schedule to
  `/sync` (idempotent replace, same shape as `reconcile()`); a once-a-minute
  cron in the Worker sends anything due via VAPID Web Push
  (`web-push-browser`, **`aes128gcm`** — Apple silently drops the legacy
  `aesgcm` encoding, learned the hard way) and deletes sent/dead rows.

**Data flow, end to end, for a single reminder:** user edits a task in
`editor.js` → `model.js` writes it → `store.js` persists + fires
`onChange` → `app.js`'s debounced listener calls `reconcile()` in
`reminders.js` → pure planners compute the current schedule → platform
branch either calls `LocalNotifications.schedule()` directly (Android) or
POSTs the schedule to the Worker's `/sync` (iOS) → Android's OS fires the
alarm itself; iOS's Worker cron fires the push a minute or less later.

**Settings / feature flags.**
`doc.settings` in `store.js` is a flat object with a `defaults()` function
merged onto whatever's in storage on load — this is *already* the toggle
infrastructure the "every feature is a toggle" rule asks for. Adding a new
flag is: add a key + default to `defaults().settings`, read it wherever the
feature branches, expose a control for it in `ui/settings.js`. No retrofit
needed structurally; just remember to actually do this for every new
feature rather than hardcoding behavior.

**UI composition.**
`ui/components.js` holds the shared primitives every screen uses:
`taskCard()` (completion animation, swipe-to-delete, hold-to-collapse
gestures all live here), `openSheet()`/`closeSheet()` (bottom sheets),
`confirmSheet()`, `toast()`. Screens (`ui/tasks.js`, `ui/calendar.js`,
`ui/settings.js`) and the add/edit form (`ui/editor.js`) are built from
these. The editor's option toolbar (Date / Timing / Priority / Color / Tags
/ Notes) is an accordion of chips, each revealing one panel — this is the
established pattern for adding a new per-task attribute with its own input
UI.

**Theming.**
CSS custom properties on `:root` (`css/main.css`); `themes.js` defines 8
full token sets (4 psychology-based families × dark/light) and swaps them
via inline style properties. No CSS-in-JS, no preprocessor.

**Testing.**
`node --test` (Node's built-in runner) over pure-logic modules only — no
DOM, no framework: parser, focus scoring, reminders/due-time math, sessions,
dates, model, filter, theme-token completeness + contrast. 85 tests as of
this writing. Playwright is used ad hoc during development for manual E2E
verification (touch gestures, live chip behavior) but is not a checked-in
CI-run suite.

## Other docs in this repo

- `README.md` — phone-centric install/usage instructions for the owner.
- `BLUEPRINT.md` — a from-scratch build spec written for a *different* AI to
  rebuild this app in a separate project. Point-in-time snapshot of intent,
  not a living doc — this file (CLAUDE.md) is the source of truth for what
  the code does right now.
- `ROADMAP.md` — candidate features for the neurodivergent-focused pillars
  above, ordered easiest → hardest for this stack, cross-referenced against
  what's already built.
