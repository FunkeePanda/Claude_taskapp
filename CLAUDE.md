# Focus — ground rules for working in this repo

Read this before making changes. It states the product's non-negotiables,
then documents the actual architecture as it exists in the code today.

## What this app is

**Focus** is a local-first task manager, mobile-first, for people whose brains
make ordinary task apps actively harder to use: ADHD, autism, OCD, anxiety,
depression, chronic fatigue, and productivity-hindered users generally.

Three pillars drive every decision:
1. **Aggressive, persistent reminders** — nagging that doesn't politely give up
   after one notification.
2. **Deep customization** — nothing about how the app looks, sounds, or
   behaves should be a one-size-fits-all default the user is stuck with.
3. **Full data ownership** — the user's tasks are theirs, on their device,
   full stop.

## Hard constraints — do not violate these

- **No cloud sync, no accounts, no subscriptions.** Never add a feature that
  requires a server to hold or sync task data, or that breaks local-only data
  ownership. The one existing server-side component (the Cloudflare Worker,
  see below) is a narrow, explicitly-scoped exception — it relays reminder
  *notifications* for iOS, transiently, and must never become a place task
  data lives or syncs.
- **No shame mechanics by default.** Overdue indicators, streaks, red badges,
  guilt-inducing copy — none of these may ship with only one harsh mode.
  Every such display must offer a **gentle** and a **hidden** mode as a
  toggle, because some users are motivated by firm deadlines and some are
  actively harmed by them. Default-on shame is not acceptable even
  temporarily "until we add the toggle" — build the toggle in the same
  change.
- **Low visual clutter, minimal animation/sound by default.** New UI should
  default to calm. See "Known tension" below — the existing check-off
  animation predates this rule and needs a deliberate decision, not silent
  removal or silent exemption.
- **Every notable feature is a toggle.** Assume features get turned off.
  Settings already has a working, low-friction pattern for this (see
  "Settings / feature flags" below) — use it from the start of a feature,
  not as a retrofit.
- **Solo dev.** Prefer the simplest implementation that works. This repo has
  no framework, no build step, no bundler, and no state-management library —
  keep it that way unless a specific feature makes it truly impossible.

### Known tension to resolve deliberately, not by default

The existing task-completion animation (bubbles converge → fill → check pops
→ cascades through subtasks) is a signature, deliberately-designed piece of
this app that the owner explicitly loves and asked to be preserved. It is
also, by the letter of the new "minimal animation by default" rule, exactly
the kind of thing that rule is about. **Don't rip it out and don't ignore the
rule** — the right move is an explicit settings toggle (e.g. "Reduced
motion") independent of the OS-level `prefers-reduced-motion` check the code
already honors, so users who want calm get it without the owner losing the
animation entirely. Flag this decision to the user before touching it.

## Actual current architecture

**Two deployment targets from one codebase, no native rebuild for either.**
`www/` is the entire app — plain ES modules, HTML, CSS. No React/Vue/Svelte,
no TypeScript, no bundler, no build step. It is capable of running as a
bare static site.

- **Android**: `www/` is wrapped by **Capacitor 7** (`capacitor.config.json`,
  `android/`) and compiled to a signed release APK via Gradle. Distributed as
  a sideloaded APK on a rolling GitHub Release (not the Play Store).
- **iPhone**: the same `www/` is hosted as a static site (GitHub Pages) and
  installed via Safari's "Add to Home Screen," which is what unlocks
  installed-PWA capabilities on iOS (notably the Push API — no Apple
  Developer Program needed, deliberately avoided).
- A single `isNative` boolean (`www/js/native.js`, from Capacitor's own
  platform detection) is the one switch used everywhere to branch
  Android-native vs. web/iOS behavior. Every native plugin call in the app
  goes through a thin wrapper in that file with a safe mock fallback for the
  plain-browser case.

**State management: no library, one in-memory singleton.**
`www/js/store.js` holds a single module-level `doc` object (the whole task
document), lazily loaded from `localStorage` on first access. All mutation
goes through `www/js/model.js` (`createTask`, `updateTask`, `deleteTask`,
`setCompleted`, etc.), which mutate `doc` directly and call `save()`. `save()`
debounces writes ~250ms and notifies subscribers via a tiny pub-sub
(`onChange(fn)`). There is no virtual DOM: views re-render by rebuilding
`innerHTML` from template literals; `www/js/app.js`'s `rerender()` is the
single entrypoint, invoked on data change (debounced 400ms), on tab switch,
and on a 30-second tick for live countdowns (paused while a sheet is open so
it never clobbers an in-progress edit). Scroll position and open
`<details>` are preserved across a rerender by hand.

**"Database": a single JSON document in localStorage, not a real database.**
Key `focus.data.v1`. No IndexedDB, no SQL, no ORM. A `.bak` copy of the prior
value is written before every overwrite as a corruption guard. Schema
evolution is a load-time backfill: `load()` sets a default for any field
missing since v1 (`if (t.field === undefined) t.field = default`) — this is
the pattern to extend for any new task field. Export/import is the entire
document as JSON (`store.js` `exportJSON`/`importJSON`), user-triggered from
Settings; this is also the app's only backup mechanism — there is no
automatic cloud backup, by design.

**Notifications — pure planners + two delivery backends.**
`www/js/reminders.js` computes *what* should fire and *when* as pure,
unit-tested functions (`occurrencesFor`, `planAll`, `dueNotification`,
`sessionNotifications`) given task state and the current time — no side
effects. `reconcile()` is the sync primitive: cancel everything currently
scheduled, reschedule from the freshly computed truth. Idempotent,
self-healing, called on load/resume/data-change. Delivery is branched on
`isNative`:
- **Android**: `@capacitor/local-notifications` — real on-device exact
  alarms. A rolling ~12h window of individual scheduled notifications
  (Android has no native "repeat every N minutes" primitive), capped at
  24/task and 180 total to stay under the OS's pending-alarm ceiling.
  Notification actions (✓ Done, Snooze) are wired and functional.
- **iPhone**: no local background alarms exist for web apps on iOS, so this
  is Web Push. `www/js/webpush.js` (client) talks to a **Cloudflare Worker +
  D1** (`worker/`) that stores per-device push subscriptions and a rolling
  table of pending notifications (title, body, fire time — nothing else),
  and a once-a-minute cron sends anything due via VAPID Web Push
  (`web-push-browser`, `aes128gcm` — Apple silently drops the legacy
  `aesgcm` encoding, learned the hard way). This Worker is the one server
  component in the whole project and is scoped narrowly on purpose: it is a
  transit relay, not a task-data store, and it self-purges sent/dead rows.

**Settings / feature flags.**
`doc.settings` in `store.js` is a flat object with a `defaults()` function
merged onto whatever's in storage on load — this is *already* the toggle
infrastructure the "every feature is a toggle" rule asks for. Adding a new
flag is: add a key + default to `defaults().settings`, read it wherever the
feature branches, expose a control for it in `www/js/ui/settings.js`. No
retrofit needed structurally; just remember to actually do this for every
new feature rather than hardcoding behavior.

**UI composition.**
`www/js/ui/components.js` holds the shared primitives every screen uses:
`taskCard()` (the card component — completion animation, swipe-to-delete,
hold-to-collapse gestures all live here), `openSheet()`/`closeSheet()`
(bottom sheets), `confirmSheet()`, `toast()`. Screens
(`ui/tasks.js`, `ui/calendar.js`, `ui/settings.js`) and the add/edit form
(`ui/editor.js`) are built from these. The editor's option toolbar (Date /
Timing / Priority / Color / Tags / Notes) is an accordion of chips, each
revealing one panel — this is the established pattern for adding a new
per-task attribute with its own input UI.

**Theming.**
CSS custom properties on `:root` (`www/css/main.css`); `www/js/themes.js`
defines 8 full token sets (4 psychology-based families × dark/light) and
swaps them via inline style properties. No CSS-in-JS, no preprocessor.

**Testing.**
`node --test` (Node's built-in runner) over pure-logic modules only — no DOM,
no framework: parser, focus scoring, reminders/due-time math, sessions,
dates, model, filter, theme-token completeness + contrast. 85 tests as of
this writing. Playwright is used ad hoc during development for manual E2E
verification (touch gestures, live chip behavior) but is not a checked-in
CI-run suite.

**CI/CD.** Three GitHub Actions workflows, all triggered on push:
`pages.yml` (deploys `www/` + writes a `version.json` build stamp the PWA
polls to self-update — critical, since iOS home-screen apps otherwise run
stale code for days), `android-apk.yml` (signed release APK → versioned
filename on a rolling GitHub Release — versioned specifically so a stale
download can never masquerade as the latest build), `worker-deploy.yml`
(wrangler deploy on `worker/` changes). **The owner works entirely from
their phone** — no local toolchain, no terminal. Every change ships via
push → CI → live download/deploy; never propose a step that requires a
computer.

## Other docs in this repo

- `README.md` — phone-centric install/usage instructions for the owner.
- `BLUEPRINT.md` — a from-scratch build spec written for a *different* AI to
  rebuild this app in a separate project. It's a point-in-time snapshot, not
  a living doc, and describes intent/design values more than it tracks the
  literal current code. Don't treat it as authoritative for "what does the
  code do right now" — this file (CLAUDE.md) is that source of truth.
- `ROADMAP.md` — candidate features for the neurodivergent-focused pillars
  above, roughly ordered easiest → hardest, cross-referenced against what's
  already built.
