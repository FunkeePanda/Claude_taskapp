# Roadmap — neurodivergent-focused feature candidates

Nothing here is implemented yet. Ordered roughly easiest → hardest **for
this stack** (see `CLAUDE.md` for the architecture). One short spec line per
item, plus conflicts and already-built status where they exist. Every item
ships with a settings toggle per `CLAUDE.md`'s design rules — not repeated
per item below.

## Tier 0 — already built (verify, don't rebuild)

**JSON export/import backup of all data.** *Fully built.*
`store.js` `exportJSON()`/`importJSON()`, wired to Export/Import buttons in
`ui/settings.js` (import validates + confirms before replacing everything).
This already **is** the data-ownership insurance — nothing to add here.

**Complete-task action from the notification itself.** *Android: done.*
`reminders.js` already registers ✓ Done / Snooze actions on the `nag` type
and a Done-only `due` type; the action listener calls `setCompleted()`
directly.
*iOS: open question, not just unbuilt.* Web Push actions need something to
handle the tap without the app open — the Worker can't safely mutate task
state without expanding its scope past "title + firing time" (see
`CLAUDE.md`, Data section). Needs a product decision before writing code.

**Persistent escalating reminders — the "persistent" half.** *Done.*
`occurrencesFor()`/`planAll()` already nag on a fixed interval indefinitely
until completed or turned off, through quiet hours. Only *escalation*
(interval changing over time) is missing — see Tier 5.

## Tier 1 — easy, pure data additions

**Procrastination count per task, opt-in, hidden by default.**
New task field + one migration line (`store.js`'s existing pattern).
Needs a product decision on what counts as an event — snooze
(`reminders.js`) and manual due-date-push-back (`editor.js`) are the two
existing hooks. No conflicts.

**Dopamine menu (user-curated quick-reward list).**
New top-level list in `store.js` (not tasks), simple add/remove UI, could
surface via the existing `toast()` action-button pattern after a completion.
No conflicts.

## Tier 2 — easy/medium, new small UI on existing patterns

**Task Jar: random task picker for decision paralysis.**
Trivial logic (random pick, optional `matchesFilter()` scoping from
`filter.js`); UI reuses `taskCard()` + `openSheet()`. No conflicts.

**Resistance/dread rating as a task field, usable in sorting.**
New editor chip (same accordion pattern as Date/Priority/Color); sorting
hooks into `focus.js`'s `score()`, which already blends weighted factors.
No conflicts. Default the on-card display off (clutter rule, not a shame
mechanic per se).

## Tier 3 — medium, touches several existing call sites

**Time estimates + daily capacity warning on the today view.**
*Conflict*: the task model already has `timer.durationMin` ("how long this
should take") — likely the same concept as a time estimate. Get a decision
on reuse-vs-new-field before building; the warning itself is just summing
`todayList()` picks against a capacity setting.

**Backburner/review dates: tasks that hide and resurface.**
New `reviewAt` field, filtered out until due — directly mirrors the existing
`archived` boolean's exclusion pattern used everywhere
(`.filter(t => !t.archived)`). No conflicts; touches multiple render call
sites but each change is mechanical.

**Super Focus Mode: one-task-at-a-time view.**
Reuses `todayList()` scoring already used for "Your focus" — mostly a new
minimal-chrome view over existing data.
*Conflict*: Today was deliberately merged into Tasks earlier this session to
kill a redundant-view problem. Build this as a modal/overlay from the
existing focus section, not a new tab, or it reintroduces that problem.

## Tier 4 — medium/hard, shared core rendering code

**Overdue display modes (firm / gentle / hidden) + "revive or release"
prompt.**
*Real conflict, prioritize relative to neighbors*: overdue styling is
hardcoded today in `fmtDue()` (`components.js`) and consumed by `tasks.js`,
`calendar.js`, and the focus section — all three need to become mode-aware.
The revive/release prompt is new UX with no existing precedent; make it
dismissible-forever per task so it doesn't become its own shame mechanic.
Several later items (dread sorting, the Wizard below) want a non-firm
"is this overdue" read — do this before those.

## Tier 5 — hard, sequencing-dependent

**Procrastination Wizard: guided break-it-down flow when stuck.**
No wizard/multi-step pattern exists anywhere in this app yet — every sheet
today is single-panel. Produces subtasks, which are already fully supported
(`openAddSheet(onSaved, { parentId })`), so this is a new guided layer over
an existing primitive, not new data capability.
*Sequencing*: most useful once dread rating (Tier 2) and overdue modes
(Tier 4) exist, since it can read the former and be offered from the
latter's revive prompt. Build those first.

**Escalating reminders — the missing half.**
Interval changing over elapsed time/occurrence count, still as a pure
function (`occurrencesFor()` becomes time-dependent, same testing pattern).
Watch the existing `MAX_PER_TASK`/`MAX_TOTAL` caps in `reminders.js` — an
aggressive curve can hit them faster than expected.
*Platform gap, flagged as requested*: Android delivery is real OS alarms;
iOS delivery is best-effort Web Push through a once-a-minute Worker cron,
which Apple can delay, coalesce, or drop, and iOS caps in-flight
notifications system-wide. Escalating nags will be meaningfully less
reliable on iOS. Surface this honestly in-app (extend the existing iOS
"no sound? here's why" row in `settings.js`) rather than promise parity.

## Tier 6 — park unless strongly wanted

**Android home screen widget (native plugin required).**
Per `CLAUDE.md`'s Platform Reality section: **not possible on iOS at all**
under the current PWA strategy (no WidgetKit without a real native app,
which was explicitly ruled out to avoid the Apple Developer Program).
Android alone is technically buildable — a native `AppWidgetProvider`
outside the Capacitor web-view bridge, reading the same localStorage-backed
data — but it's real native-code surface area with no shared-code reuse.
Recommend parking per the brief unless there's a specific strong pull for
it; if pursued, Android-only from day one, no promise of iOS parity.
