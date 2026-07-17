# Roadmap — neurodivergent-focused feature candidates

Nothing here is implemented yet. This is a structured candidate list, roughly
easiest → hardest, cross-referenced against the actual code (see `CLAUDE.md`
for the architecture these notes assume). Every item must ship with a
settings toggle per the ground rules in `CLAUDE.md` — that's not repeated
per-item below, it's a blanket requirement.

## Tier 0 — already built or partially built (verify before doing more)

### Complete-task action directly from the notification
**Status: done on Android. Open question on iPhone.**
Android already has this: `www/js/reminders.js` registers a `nag` action
type with **✓ Done** + **Snooze 1h** buttons, and a `due` action type
(Done-only) for the due-time alerts added this session. The
`localNotificationActionPerformed` listener calls `setCompleted()` directly.
Nothing to build here for Android.

iPhone is a real open question, not just unbuilt work: Web Push notifications
*can* have action buttons, but `www/sw.js`'s `notificationclick` only
focuses/opens the app today. Handling an action tap without the app open
means either (a) opening the app to complete it there — which isn't really
"from the notification," or (b) the Cloudflare Worker relaying a
"mark complete" event back into the app's state — which reopens exactly the
kind of server-touching-task-data problem the no-cloud rule exists to
prevent, since task data lives only in the page's `localStorage`, not on the
Worker or in the service worker. **Needs a product decision before any
iOS-side code is written.**

### Persistent escalating reminders per task
**Status: the "persistent" half is done. Escalation is not.**
This already exists almost exactly as specced: a task's "notify me every N
minutes" reminder (`occurrencesFor()`/`planAll()` in `reminders.js`) already
repeats indefinitely until the task is completed or the reminder is turned
off, governed by quiet hours. What's missing is *escalation* — the interval
is currently one fixed number for the task's whole life. See Tier 5 below for
what adding that actually involves.

## Tier 1 — easy, pure data additions, no new UI patterns

### Procrastination count per task (opt-in, never shown by default)
Increment a counter on a task each time a defined "procrastination event"
happens (needs a product decision on what counts — snoozing a reminder is
the closest existing hook, in the `snooze` action handler in `reminders.js`;
manually pushing a due date later in `editor.js`'s save handler is another
candidate). New task field, same one-line migration pattern `store.js`
already uses for every prior field addition. Display is opt-in via a
settings flag — never rendered by default, satisfying the shame-mechanics
rule by construction rather than by afterthought.
No conflicts.

### Dopamine menu (user-curated quick-reward list)
A separate user-editable list (not tasks) — e.g. `doc.dopamineMenu: []` in
`store.js` — with simple add/remove, probably its own small sheet or a
Settings sub-section. Could optionally surface a random entry via the
existing `toast()` action-button pattern (`components.js`) after a task
completes, reusing the `onComplete` callback path already wired in
`tasks.js`.
No conflicts — fully additive, no shame dimension.

## Tier 2 — easy/medium, new small UI using existing patterns

### Task Jar: random task picker for decision paralysis
Pick one random open task (optionally scoped by tag/color via the existing
`matchesFilter()` in `filter.js`) and present it full-screen. Logic is
trivial; UI reuses `taskCard()` and `openSheet()` from `components.js`.
Natural entry point: a button near the FAB or in the "Your focus" section.
No conflicts.

### Resistance/dread rating as a task field, usable in sorting
A 1–5 (or similar) "how much do I not want to do this" rating, set via a new
chip in the editor's option toolbar — `editor.js`'s accordion pattern
(Date/Timing/Priority/Color/Tags/Notes) is built exactly for adding one more
attribute this way. For sorting, `focus.js`'s `score()` is a pure function
that already blends several weighted factors (urgency, priority, staleness,
reminder bonus); adding a dread term is a small, isolated, testable addition
to it — the existing `test/focus.test.js` is the pattern to extend.
No conflicts. Default the on-card display to off, same reasoning as
procrastination count — not a shame mechanic per se, but keeps to the
low-clutter rule.

## Tier 3 — medium, touches several existing call sites

### Time estimates + daily capacity warning on the today view
**Overlap to resolve before building**: the task model already has a
`timer: { durationMin }` field — "how long this should take" — shown as a
chip and used for focus-session countdowns. That is semantically a time
estimate already. A capacity warning is mostly an aggregation: sum
`timer.durationMin` across today's un-started picks (`todayList()` in
`focus.js`) and compare to a configurable daily-capacity setting — no new
task field needed if the existing `timer` field is reused. Get a product
decision on "is this the same concept as the task timer" before adding a
second, confusingly similar field.

### Backburner/review dates: tasks that hide and resurface
A `reviewAt: epoch|null` field; hide the task from every "open tasks" view
until `reviewAt <= now`. The codebase already has a directly-reusable
precedent for exactly this shape of filter: the `archived` boolean is
already excluded at every call site (`.filter(t => !t.archived)` in
`tasks.js`, `calendar.js`, etc.) — `reviewAt` should follow the identical
convention. Needs one new UI surface to set the date (new editor chip, or an
action on the existing swipe/gesture set) and one to manage backburnered
tasks (a collapsible section, mirroring the existing "Done" section pattern
in `tasks.js`).
No conflicts; touches multiple files but each change is mechanical.

### Super Focus Mode: one task at a time view
Reuses `todayList()`/`focus.js` scoring already used for "Your focus" — this
is mostly a new, minimal-chrome view over already-computed data, not a new
data capability.
**Conflict to flag**: earlier this session, the Today tab was deliberately
*merged into* Tasks specifically because two views showing overlapping task
lists felt redundant and confusing. A new persistent Super Focus tab would
reintroduce that exact problem. **Recommend building this as a modal/overlay
reachable from the existing "Your focus" section**, not a new tab, to stay
consistent with that precedent.

## Tier 4 — medium/hard, requires changing shared/core rendering code

### Overdue display modes: firm / gentle / hidden + "revive or release" prompt
**This is the clearest, most direct conflict with the current code**, and
should be prioritized relative to its neighbors because several other items
(dread-based sorting, Super Focus Mode's task selection, the eventual
Procrastination Wizard) will want to read "is this overdue" without
inheriting today's hardcoded firm framing.

Today, overdue styling is hardcoded in exactly one place conceptually but
consumed everywhere: `fmtDue()` in `components.js` always returns
`{ text: 'Overdue Xh', cls: 'overdue' }`, styled red via `--danger` in
`main.css`, and `tasks.js`'s grouping logic always creates a dedicated
"Overdue" section header. Both need to become mode-aware (a settings value
read at render time), and since `fmtDue()`/`taskChipsHtml()` is called from
`tasks.js`, `calendar.js`, and the focus section, this is a small number of
functions but a change with real reach — test carefully across all three
call sites.

The "revive or release" prompt (reschedule or archive/delete a long-overdue
task, framed non-punitively) is new UX with no existing precedent in the
app — needs a trigger policy (e.g., first open after N days overdue) and
must itself avoid becoming a shame mechanic: make it dismissible-forever
per-task, not a recurring nag.

## Tier 5 — hard, has real sequencing dependencies on earlier items

### Procrastination Wizard: guided break-it-down flow
The most UI-novel item here — every existing sheet in this app is a
single-panel form; there's no multi-step/wizard pattern anywhere to extend.
The primitive it produces (subtasks) is already fully supported —
`openAddSheet(onSaved, { parentId })` already exists exactly for "add a
subtask of X" — so this is a new guided UI layer driving an existing
primitive repeatedly, not new data capability.
**Sequencing**: this is most useful when it can be offered contextually from
the overdue "revive" prompt (Tier 4) and can read/write the dread rating
(Tier 2) to help decide when to suggest itself. Build those first.

### Escalating reminders (the missing half of Tier 0's item)
Making the nag interval shorten or intensify over elapsed time/occurrence
count is a genuinely harder scheduling problem than today's fixed interval,
though it stays within the existing pure-planner architecture
(`occurrencesFor()` becoming a function of elapsed time, still testable the
same way). It also runs directly into limits already baked into the code on
purpose: `MAX_PER_TASK = 24` and `MAX_TOTAL = 180` per rolling 12h window
(`reminders.js`), there to keep Android under its pending-alarm ceiling —
an aggressive escalation curve could hit these caps faster than expected and
needs testing against them.

**Flag explicitly, as requested**: iOS reminder delivery is fundamentally
less reliable than Android's for this feature. Android alarms are real,
local, OS-guaranteed. iOS delivery is a Cloudflare Worker cron firing every
minute over best-effort Web Push — Apple's push service can delay, coalesce,
or drop pushes under battery/network pressure, and iOS caps how many
pending notifications an app can have in flight system-wide. True escalating
persistent nagging will work better on Android than iPhone, and that gap
should be surfaced honestly in the app (the existing iOS "no sound? here's
why" guidance row in `settings.js` is the right pattern to extend) rather
than silently promised as identical across platforms.

## Tier 6 — hardest: platform-strategy decisions, not just engineering

### Home screen / lock screen widget showing current focus task
By far the biggest structural conflict with this codebase's whole design.
Widgets are native OS surfaces that cannot be built in the shared `www/`
web app at all:
- **Android**: possible, but requires genuinely native code (a Kotlin/Java
  `AppWidgetProvider`) added to the `android/` Capacitor project, entirely
  outside the web-view bridge. Real, scoped, buildable work.
- **iPhone**: not achievable under the current strategy, full stop. iOS
  widgets require a WidgetKit extension written in Swift, which can only
  ship inside a true native iOS app distributed via the App Store or
  TestFlight. This project's iPhone story is deliberately a Safari
  home-screen PWA specifically *to avoid* the $99/yr Apple Developer
  Program and native App Store distribution — that was an explicit, already
  litigated decision (see `BLUEPRINT.md`'s context section). Reversing it to
  get a widget is a strategy-level call the owner has to make, not something
  to build quietly as a side effect of "add a widget."

**Recommendation**: if this is wanted, decide the iOS strategy question
first, independent of and before any Android widget code is written.
