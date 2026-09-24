# Planora — Development Plan

**Version:** 1.0 (rewrite) · **Date:** 2026-09-08 · **Supersedes:** everything in `Mark_Downs/` of the legacy directory

> This document consolidates the six legacy documents of the v1 (Appendix A). Where they disagree with it, it wins. Where the codebase disagrees with it, the pull request that changes the code changes the plan too (§8.5).

---

## 1. What Planora is, and what we inherit

Planora is a **project operating system**: a Kanban board whose columns mean something, a progress number that reflects the state of the work rather than a count of finished cards, an automatic health audit that names its own reasons, tasks that keep the record of how they were done, and — later — an assistant that reads all of it.

Ten mechanics separate it from an ordinary board: phase-weighted progress, automatic health, **Drop Catch** (an invalid move is intercepted mid-drag and the card springs back to where it came from, with the reason named), automatic phase history, columns with a logical role, an explanatory right sidebar, the task as an operational document, portfolio-level views, a real cloud backend, and an assistant grounded in project context. Those survive this rewrite untouched. What does not survive is how they were built.

### 1.1 The problem this plan fixes

The v1 accumulated **3,786 lines of specification** across six documents against a `src/` of **956 lines**, 413 of them CSS. Nearly every rule the product depends on existed only as prose — and prose does not run, does not fail, and does not tell you when it has drifted from the code. The v2 inverts that ratio by putting each rule of the product into a pure, tested module that the server and the interface share.

### 1.2 What we keep

| Kept | Detail |
|---|---|
| The hybrid progress engine | Phase, checklist and blocking, with the same bands: 0 / 30–69 / 70–99 / 100 |
| The health idea | Rebuilt in §3.5 as five normalized dimensions, because the original penalty model inverted on project size |
| Drop Catch and phase history | The two mechanics that most distinguish the product |
| The complete design system | Tokens, the matte earthy palette, Playfair + Inter, the column and card measurements already extracted under `UI specs/` |
| The feature summary | Its twenty sections become the backlog and the test cases — not a document to maintain |
| Visual assets | Icon, backgrounds, the component kit |

### 1.3 What we leave behind

| Dropped | Why |
|---|---|
| Authority split between RLS and the domain | Two sources of truth for one rule guarantee divergence |
| Mock data inside components | Sample data leaves `KanbanBoard.tsx` and becomes importable fixtures |
| Inline styles and loose hex values | Default Tailwind colours living beside tokens nobody consumed |
| 1,500-line instruction documents | No agent carries them into context and no human re-reads them |
| A project with no Git | Every line of that specification lived without history or backup |
| `owner_id` as the isolation model | Replaced by `workspace_id` from the first migration (§4.1) |

The legacy directory is not deleted: it is the best requirements source that exists for this product. It becomes read-only, and Appendix A records where each of its documents went.

## 2. Architecture

A modular monolith in vertical slices. Each module — workspaces, projects, board, tasks, files, automations, ai — owns its own stack of action, service and repository. What cuts across all of them is the domain, and the domain is the only layer with no dependencies at all.

### 2.1 The layers

| Layer | Role |
|---|---|
| `app/` | Routes, layouts and Server Components. **Reads** through the DAL, **writes** through Server Actions. Zero calculation. |
| `features/` | Client islands: the board with its drag, forms, the editor. May import `domain/` for instant feedback. |
| `components/` | Dumb, reusable UI driven only by props and tokens. |
| `server/modules/<module>/` | Per module: **actions** (validate input) → **services** (authorize, orchestrate, transact) → **repositories** (Drizzle). |
| `server/auth/` | The DAL: `requireSession()` and `requireWorkspace()`, marked `server-only` and memoized per render with React `cache`. |
| `server/events/` | The outbox writer and its dispatcher. |
| `server/db/` | Drizzle schema, versioned migrations, deterministic seed. |
| `domain/` | **Pure functions.** Progress, health, movement, dependencies, phase history. Imports no React, no Next, no Drizzle, no database. |
| `lib/` | Shared utilities. Never a business rule. |

### 2.2 The rule that holds the rest up

`domain/` is isomorphic and pure. The board imports `canMoveTask()` to bounce a card before any request is made; the service imports **the same function** to decide whether to write. One rule, two consumers, no duplication — and the interface stops being a place where business logic lives by accident.

This is verified, not agreed: an ESLint boundary rule forbids any import of `server/`, `app/`, `next`, `react` or `drizzle-orm` inside `domain/`, and CI fails when someone tries.

### 2.3 Read path and write path

```
read    Server Component → requireWorkspace() → queries → render
write   client → Server Action (Zod) → service → domain → repository ─┐
                                          └→ outbox_events (same transaction) ┘
```

Server Components read through the DAL; the client does not fetch for an initial render. Writes go through Server Actions, and the service is the only place that opens a transaction. Route Handlers exist only where an action cannot reach: webhooks, upload callbacks, AI streaming and the scheduler endpoint.

**Domain refusals are values, not exceptions.** The domain answers `Allowed | Refused(reason)` — it decides, it does not perform. A service wraps that answer in the outcome of the work it did: `Ok(result) | Refused(reason)`. Both live in one `Result` type in `lib/`. A thrown error means something unexpected, and only those reach an error boundary. This is what lets the board render "blocked by TSK-14" instead of a generic failure toast.

### 2.4 Tenant isolation

Every repository takes a `TenantContext` — `{ workspaceId, userId, role }` — as its first argument, and only the DAL can produce one, from the session. No repository reads a session on its own, and no query runs without `workspace_id` in its `where`. Combined with the composite foreign keys of §4.1, a cross-tenant read requires two independent failures.

RLS arrived in Phase 10 as a second barrier, and building it corrected this paragraph twice (ADR 0002). Because the application connects through a transaction-mode pooler, an explicit transaction is the only unit of session state there is: a statement sent outside `BEGIN` is its own implicit transaction and may land on any backend, so a setting applied to one statement is not there for the next. Every access therefore opens a scope — reads included, which until then ran as plain queries — and the scope is opened at the entry point, the Server Action or the Server Component, because twenty-seven of the forty-one service functions never opened a transaction of their own. And the policies do not trust the setting: they resolve it through a `SECURITY DEFINER` function that returns the workspace only when `workspace_members` says the user is in it, so a wrong `TenantContext` — the failure this barrier exists to catch — is refused by the database rather than obeyed by it. For the barrier to be real, the application connects as a role that **cannot** bypass it: `planora_app`, a non-owner without `BYPASSRLS` and with no grant at all on the identity tables, against tables carrying `FORCE ROW LEVEL SECURITY`, while migrations keep running as the owner. Four paths are deliberately outside it, on a second `BYPASSRLS` role, because they read across every workspace by construction: Better Auth's own tables, the outbox dispatcher and the clock, email delivery and digests, and the signup path that writes a person's first workspace before there is a membership to check it against.

Even so, RLS is a backstop and not the source of truth. The authority is the `TenantContext`; the database is the thing that catches the day the context is wrong.

### 2.5 What Next 16 imposes

The repository scaffolds **Next 16.3.4 with React 19.2.8** (the legacy project pinned 16.2.6). Its breaking changes are load-bearing for this plan — each of these was checked against the framework's own bundled documentation under `node_modules/next/dist/docs/`, and should be re-checked there rather than remembered whenever the version moves:

- **`params` and `searchParams` are Promises.** Every page and layout awaits them.
- **`middleware.ts` is now `proxy.ts`**, it runs on the Node runtime and that is not configurable — the edge runtime is not supported there. Config flags renamed with it (`skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`).
- **Proxy is for optimistic checks only.** The framework's own guidance is that authorization belongs in a Data Access Layer as close to the data as possible; the proxy reads the session cookie and redirects visitors, nothing more. §2.4 is that recommendation taken seriously.
- **Turbopack is the default bundler** for both `dev` and `build`.
- **Node 20.9+ and TypeScript 5.1+** are hard minimums.

React Compiler support, Partial Prerendering and the new caching APIs (`cacheLife`, `cacheTag`, `updateTag`, `refresh`) are available and deliberately unused in the MVP: they are optimizations, and optimizing a product that has no users yet is how phases stop finishing.

### 2.6 Folder shape

```
src/
  app/                    page.tsx (the front door) · (auth) · (app)/{dashboard,projects,board,files,users,assistant,settings,invitations} · (dev)/dev/ui · api/
  features/               board · projects · tasks · workspace · health · dashboard · settings · automations · notifications — client islands and the panes
  components/             ui primitives, layout, feedback
  domain/                 progress · health · kanban · dependencies · phase-history · projects
  server/
    auth/                 DAL, Better Auth config, the one signing secret
    modules/              workspaces (export, preferences) · projects · board · tasks (attachments live here) · health · dashboard · activity · files · automations (rules, runs, routines) · notifications (inbox, email, digests) · later ai
    events/               outbox writer, dispatcher, dispatch-soon
    db/                   schema · migrations · seed
    storage/              the storage port and its three adapters: Supabase, filesystem, memory
    limits/               the allowance on write actions: the system lane's counter, and `writing()`
    content/              the HTML allowlist everything an editor writes passes through
  fixtures/               sample data, imported by the domain tests
  lib/                    calendar, ids, strings (the pt-BR dictionary), the Result type
  styles/                 tokens, Tailwind theme
  proxy.ts                redirects unauthenticated visitors, nothing more
docs/                     DEVELOPMENT_PLAN.md · STATUS.md · DEPLOY.md · adr/ · design/ (the v1 kit, read-only reference)
scripts/                  migrate.mjs, run by the pipeline before a production build
tests/                    e2e (Playwright); unit and integration tests live beside their modules
```

## 3. The domain engine

This is the product. Everything Planora sells — progress that reflects reality, a health verdict, a board that refuses invalid moves, a task that keeps its own history — is deterministic: state goes in, a number or a decision comes out. So it is written first, as pure functions, before any database and before any screen.

**The purity contract.** `domain/` imports nothing from `react`, `next`, `drizzle-orm`, `server/` or `app/` — `lib/` is the only internal import it may take, and only for pure helpers. It receives plain data and returns plain data. This is enforced by an ESLint boundary rule and breaks CI, because it is the property that lets the board and the service share one implementation instead of two that drift.

### 3.1 The five modules

| Module | Answers |
|---|---|
| `progress` | How far along is this task, this project — before and after accounting for what is stuck? |
| `health` | Is this project healthy, and which two things should be dealt with first? |
| `kanban` | May this task move there, and where does it land in the order? |
| `dependencies` | Is this task blocked, and would this new link create a cycle? |
| `phase-history` | What does the task's body look like after leaving a phase? |

### 3.2 Phases and columns

A column is not a list — it carries a typed `phase`, and the phase is what the engine reads:

| Phase | Range | Rule |
|---|---|---|
| `planning` | 0% | Contributes nothing to the project's progress |
| `execution` | 30–69% | Immediate base weight on entry; checklist fills the band |
| `review` | 70–99% | Hard ceiling: a full checklist still stops at 99 |
| `done` | 100% | Absolute, derived from the phase — never from a string or an id |

A project may add columns (`Tests`, `Client approval`, whatever the work needs), and each one declares which phase it belongs to. **When a phase holds several columns, its band is split evenly between them in board order** — with two execution columns, the first sits on 30–49.5 and the second on 49.5–69. Moving a card one column to the right is therefore always visible progress, which is the whole reason the board has columns instead of a status field. *(Decision D1.)*

`planning` and `done` are immutable: they cannot be renamed away from their phase, deleted, or moved out of the first and last positions.

### 3.3 Task progress

```
taskProgress(task, column, columnsInSamePhase):
  planning -> 0
  done     -> 100
  [floor, ceiling] = slotFor(column, columnsInSamePhase)   // even split of the phase band
  ratio = checklist.total === 0 ? 0 : checklist.done / checklist.total
  return min(ceiling, floor + ratio * (ceiling - floor))
```

A task with no checklist sits at the floor of its slot: entering execution is worth something on its own. Being blocked does **not** change a task's own progress — a blocked task has still done the work it has done. Blocking is a project-level signal, and §3.4 is where it bites.

Two consequences worth stating rather than discovering: a slot's ceiling equals the next slot's floor, so a fully checked task in the first execution column reports the same number as an empty task in the second — accepted, because progress across a move is still monotonic and the card shows which column it is in. And **soft-deleted tasks are excluded from every calculation in this section**; `deleted_at` means the task is gone for the engine.

### 3.4 Project progress: raw and adjusted

```
raw      = mean(taskProgress(t, columnOf(t), phaseSiblings(t)) for t in tasks)
adjusted = mean(t.isBlocked ? 0 : taskProgress(t, ...) for t in tasks)
```

Blocked work contributes **zero** to the adjusted figure rather than being penalised by a fudge factor — a bottleneck is worth nothing until it is cleared, and a rule you can explain in one sentence is a rule people trust. *(Decision D2.)*

Both figures pass through the completion lock:

```
if any task is not in a done column:
   value = min(99, value)     // never rounds up to 100
```

The interface shows the adjusted number and reveals the raw one on demand, so the gap between them is legible: that gap *is* the cost of the bottlenecks.

**Empty and degenerate inputs.** A project with no tasks reports 0, not 100 and not an error. Every figure the engine returns carries one decimal internally and is rounded half-up for display, except where the completion lock applies — nothing rounds up to 100. And **entering `done` clears the block flag**: a task cannot be finished and stuck at the same time, which is what keeps raw and adjusted from disagreeing on a completed project.

### 3.5 Health

Health is the claim the product makes that a board cannot: *this project is in trouble, and here is why*. Getting it wrong in either direction is expensive — a false alarm trains the user to ignore the badge, and a false calm is the reason the badge exists.

**Why it is not a penalty score.** The obvious model — start at 100, subtract a fixed amount per problem — fails on the first real project. Five tasks with two blocked would score better than a hundred tasks with twelve blocked, even though the first project has 40% of its work stuck and the second 12%. Fixed penalties measure the *count* of problems when what matters is their *share*. So no dimension counts anything: three of them are shares of affected work over open work, and the other two are ratios against the calendar and against recent activity. All five are scale-free.

#### The unit of work

Each open task carries a weight, because a blocked task that three others wait on is not the same event as a blocked task nobody needs:

```
weight(task) = priorityWeight × (1 + 0.5 × min(directDependents, 3))
priorityWeight: high 3 · medium 2 · low 1
```

`directDependents` counts only the tasks that name this one as a blocker — not the transitive closure. Blocking propagates (§3.7), but weight does not, or one stuck task at the head of a chain would dominate every dimension.

Tasks in `done` are excluded everywhere in this section, and so are soft-deleted ones. `openWeight` is the sum over the rest.

#### Five dimensions, each 0–100, higher is better

| Dimension | Question | Formula |
|---|---|---|
| **Flow** | How much of the open work is stuck? | `100 × (1 − blockedWeight / openWeight)` |
| **Punctuality** | How much of it is past its date, and by how far? | `100 × (1 − Σ weight × max(0, min(1, daysLate/14)) / datedWeight)` |
| **Freshness** | How much of it has stopped moving? | `100 × (1 − Σ weight × staleFactor / openWeight)` |
| **Pace** | Is progress keeping up with the calendar? | `100 × min(1, rawProgress / min(1, elapsedShare))` |
| **Momentum** | Did anything move at all this week? | `100 × min(1, touchedShare / 0.2)` |

Each denominator is its own: Punctuality divides by `datedWeight`, the weight of open tasks that actually carry a due date, because scoring undated work as punctual would manufacture calm out of missing data. Where a denominator is zero, the dimension is dropped rather than scored.

Four details carry most of the accuracy:

- **Lateness is not binary.** A task one day overdue is a different fact from one three weeks overdue; the `daysLate/14` ramp saturates so that a single ancient task cannot alone sink the dimension.
- **Staleness is measured per phase**, from `task_phase_history`. Sitting two weeks in planning is normal; two weeks in review is a problem. Defaults: planning 14 days, execution 7, review 5. `staleFactor = clamp(0, 1, (daysInColumn − threshold) / threshold)`, so it ramps in rather than tripping. A task that has never moved has no history row — `daysInColumn` then counts from `created_at`.
- **Pace uses the project's own dates**, against **raw** progress rather than adjusted — blocking is already Flow's job, and charging it twice would make one bottleneck read as two problems. `elapsedShare` is the share of the start→due window already gone, capped at 1 so an overdue project does not decay towards zero forever; the lateness of the project itself is Punctuality's business. A project 80% through its calendar showing 30% progress scores 37.5 here even with nothing blocked, late or stale — the signal the previous model was blind to. Before the start date, or when start and due coincide, the dimension is dropped rather than divided by zero.
- **Momentum measures activity**: the share of tasks touched (moved, completed, checked, commented) in the last 7 days, against a 20% baseline. Its denominator is every task that was open at any point in the window — a task completed on Tuesday stays in it, or finishing work would lower the score. The engine stays pure: the service reads the event stream of Phase 2 and passes the touched set in. This is what catches the project that is quietly abandoned — nothing formally wrong, and nothing has happened in three weeks.

#### Composition

```
score = Σ (dimension × weight) / Σ weight        // applicable dimensions only
      Flow .30 · Pace .25 · Punctuality .20 · Freshness .15 · Momentum .10

ceiling by the worst of Flow and Punctuality:
  < 70  ->  score = min(score, 84)               // cannot be Healthy
  < 50  ->  score = min(score, 69)               // cannot be better than At risk
  < 25  ->  score = min(score, 49)               // Critical
```

The ceiling is what keeps the verdict honest: a project cannot be called healthy because four averages are comfortable while a third of its work sits blocked. It reads from **Flow and Punctuality only** — the two dimensions that describe the work itself rather than the clock. That restriction is deliberate and was learned the hard way: a ceiling driven by every dimension turns a quiet fortnight into `Critical`, because Freshness and Momentum both go to zero when nobody touches anything, and a solo maintainer taking a holiday is not a project in crisis. Inactivity should lower the score through the weighted average, where it is worth its .15 and .10 — not seize the verdict.

**Dimensions that cannot be computed are dropped, not guessed** — and the rule is general, not a special case for Pace. A dimension is dropped whenever its denominator is zero or its inputs are absent: no project dates (or a start on or after the due date) drops Pace; no open task carrying a due date drops Punctuality, because scoring it 100 would manufacture calm out of missing data; an empty `openWeight` drops all five. The remaining weights renormalize, and the ceiling reads only the surviving dimensions — with Punctuality dropped, Flow decides it alone.

A project with fewer than three open tasks, or younger than three days, reports `Insufficient data` — a neutral badge, not a verdict. A brand-new project with one blocked task is not `Critical`, it is new. **A project whose tasks are all done is `Healthy`, not `Insufficient data`**: finished is a state, not a lack of evidence.

```
score >= 85  Healthy
score >= 70  Attention
score >= 50  At risk
score <  50  Critical
```

#### Stability, and why it matters here

Health is not only a badge: in Phase 9 it becomes an event that fires automations and sends email. A verdict that flickers across a boundary would turn into notification spam and teach the user to mute the product. Two rules prevent that:

- **Hysteresis.** A verdict only changes when the score crosses the boundary by at least 3 points, or when it has stayed across for two consecutive daily evaluations — where an evaluation is a snapshot row, so a project nobody opens simply keeps its last verdict until it is read again. The first evaluation of a project has no previous verdict to defend and sets one directly, and a score that jumps two bands at once moves two bands at once: the margin guards the boundary being crossed, not the distance travelled. `project.health_changed` is emitted on a change of *verdict*, never on a change of score.
- **A daily snapshot** per project — score, verdict and the five dimensions — so the dashboard can say `At risk, worsening for 5 days` instead of just `At risk`. It is one small row per project per day, and it is what makes the shareable progress report of Wave 1 (§6.5) worth reading. Until the Phase 9 scheduler exists, the row for today is written lazily whenever a project is read; the unique index on `(project_id, date)` makes that idempotent.

#### What the engine returns

Never a bare number. Every evaluation carries the five dimension scores and a list of findings. Flow, Punctuality and Freshness produce **task findings**, each naming the task, the signal and the weight it contributed. Pace and Momentum produce **project findings**, because no single task is to blame for a calendar or a quiet week — a verdict driven by those shows the project-level reason instead of an empty list, which is exactly what a per-task-only design would render as an unexplained badge.

The engine also takes the **previous snapshot** — verdict and score — as an input. Hysteresis is a function of state, and a pure function cannot remember; the service reads the last row and passes it in.

**Bottlenecks** are the tasks carrying any signal, ordered by the weight they contribute. **Top 2** takes the two heaviest, deduplicated by reason so the user does not get the same problem twice. Together these are what let the right sidebar explain the badge, and what let a Phase 9 rule fire on `flow < 60` rather than on a magic threshold buried in a component.

### 3.6 Movement rules

`canMoveTask()` is shared by both sides of the wire: the board calls it during a drag to bounce the card before any request, and the service calls it to decide whether to write.

```
canMoveTask({ task, from, to, context, ack? }) -> Allowed | Refused(reason)

Refused when:
  to.phase === 'done' and task.blockFlag is set             -> 'blocked'
  to.phase === 'done' and unresolved dependencies remain    -> 'dependencies'
  to.phase === 'done' and checklist incomplete              -> 'checklist'   unless ack === 'checklist'
```

The first two are separate on purpose. `isBlocked` in §3.7 is the *union* — manual flag or unresolved dependency — and is what Flow reads; here the two are tested apart so the toast can say which one it was. Testing the union first would make `'dependencies'` unreachable and the message useless.

Blocking and unresolved dependencies are absolute. The checklist refusal is **confirmable**: the drag is refused, the interface asks, and the confirmed retry passes `ack: 'checklist'` through the Server Action, so the service evaluates the same function with the same acknowledgement rather than trusting a client flag. Forcing does **not** tick the remaining items — they stay open, and the activity entry records the completion as forced. Silent completion of unfinished work is what makes a progress number worthless. *(Decision D4.)*

Column immutability is a separate question with a separate function — `canEditColumn(column, operation)`, covering rename, delete and reorder — because it validates an operation on a column, not a move of a task. Keeping the two apart is what stops `canMoveTask` from growing into a general permission oracle.

A refusal is not an error dialog — the card bounces back elastically to its origin column and a toast names the reason. On the server the same refusal is a typed failure, so a forged request gets the same treatment as a drag.

**Ordering** uses a fractional index: a card dropped between two neighbours takes the midpoint of their base-62 keys, so a move writes exactly one row instead of reindexing the column. Text keys always have a midpoint — appending a character produces one — so rebalancing is not about running out of room but about keys growing unbounded: a column is rebalanced when any key in it exceeds 32 characters.

### 3.7 Dependencies

A task is blocked when its manual flag is set, or when any task it depends on is not in `done` — blocking is transitive, so a chain surfaces the real root, not the nearest link. Before a new dependency is written, a depth-first walk rejects any edge that would close a cycle, with the offending path in the error so the interface can name it.

### 3.8 Phase history

Moving a task between phases consolidates the internal notes of the phase being left into the task body, under a section labelled with that phase and the date, and clears the notes field for the new phase. It is a pure transformation of `(body, notes, fromPhase, at)`, which is what makes it testable and what makes the task read, months later, as a record of how the work actually went.

### 3.9 Definition of done for the domain

Phase 1 ends when Vitest covers the edge cases the legacy documents described only in prose:

- a review task with every checklist item ticked reports 99, never 100;
- a project with one active task outside `done` never rounds to 100;
- a blocked task is refused entry to `done` — and its progress still counts in raw while contributing zero to adjusted;
- a circular dependency is rejected before it is written, and a transitive block reports its root;
- a phase change archives the previous phase's notes into the body and empties the notes field;
- splitting a phase band across two columns produces monotonically increasing progress left to right;
- health is scale-invariant: 5 tasks with 2 blocked and 100 tasks with 40 blocked return the same Flow score;
- a project with no dates skips Pace and renormalizes; one with two open tasks reports `Insufficient data`; one whose tasks are all done reports `Healthy`;
- a project on time with nothing blocked but no activity for three weeks is not `Healthy` — and is not `Critical` either, because the ceiling reads Flow and Punctuality only;
- a project whose open tasks carry no due dates drops Punctuality instead of scoring it 100;
- completing a task never lowers Momentum;
- a score oscillating around a boundary does not change the verdict, and emits no `health_changed` event.

### 3.10 Decisions taken

All of these are settled, not open. The rejected alternative is kept because knowing what was considered is what stops it from being relitigated in six months.

| | Decision | Taken | Rejected |
|---|---|---|---|
| D1 | Several columns in one phase | Band split evenly, in board order | All columns in a phase share one base value |
| D2 | Blocked tasks in adjusted progress | Contribute 0 | Contribute a fraction, or subtract a fixed penalty |
| D3 | Health model | Five normalized dimensions, weighted, with a worst-dimension clamp — **all five built in Phase 1** | A reduced MVP set (Flow + Punctuality + Freshness) with Pace and Momentum later |
| D3a | Dimension weights and thresholds | .30/.25/.20/.15/.10; stale at 14/7/5 days per phase; 20% weekly touch baseline | Tuned in Phase 13 against real snapshots; the shape does not change |
| D4 | Completing with an open checklist | Allowed with an explicit acknowledgement, logged as forced, items left open | Refused outright |

## 4. Data model

Postgres on Supabase, accessed through Drizzle over a direct connection. The schema is TypeScript, migrations are versioned SQL generated from it, and the table types *are* the application types — there is no generation step anyone can forget to run.

### 4.1 Conventions that apply to every table

- **`workspace_id` from the first migration**, on every business table, including the ones that look like they do not need it. It costs nothing now and costs a data migration later.
- **Composite foreign keys carry the tenant.** `tasks(workspace_id, project_id)` references `projects(workspace_id, id)`, not just `projects(id)`. A row from one workspace cannot be linked to a row from another even if the application layer has a bug — the database refuses it.
- **Every query index leads with `workspace_id`**, because every query does. Uniqueness constraints scoped to a parent are the exception — `(project_id, number)` needs no tenant column, since the project already carries one and the composite foreign keys make a cross-tenant parent impossible.
- **UUID v7** for primary keys: unique like a UUID, time-ordered like a sequence, so inserts stay local in the index instead of scattering. Generated in the application through one helper in `lib/`, not by the database — the Postgres version on a managed host is not ours to depend on.
- **`timestamptz` in UTC**, always. Formatting is a presentation concern.
- **Enumerations are `text` with a check constraint**, not Postgres enums — adding a value should be a migration, not a ritual.
- **`created_at`, `updated_at`, `created_by`** everywhere. `deleted_at` only on `projects` and `tasks`, where an accidental delete needs an undo; everything else is deleted for real.
- **snake_case in the database, camelCase in TypeScript**, mapped once in the Drizzle schema.

**One Supabase-specific note:** Supabase reserves the `auth` schema for its own authentication, which we are not using. Better Auth's tables live in `public` alongside the application's — `public.users` and `auth.users` can coexist, but nothing may read the latter. The Supabase SDK appears in exactly one place in this codebase: Storage.

### 4.2 The tables, by group

| Group | Tables | Arrives in |
|---|---|---|
| **Identity** | whatever Better Auth's Drizzle adapter defines — users, sessions, accounts, verifications | **Schema in Phase 2**, wired up in Phase 3 |
| **Tenancy** | `workspaces`, `workspace_members` (owner · admin · manager · member · viewer), `workspace_invitations` | Phase 2 · invitations in 3 |
| **Portfolio** | `projects` (start and due dates, status, position, `client_id`), `clients`, `board_columns` (typed `phase`, position, immutability flag) | Phase 2 · clients in 5 |
| **Work** | `tasks`, `task_assignees` (schema in Phase 2, written from Phase 8), `task_checklist_items`, `task_dependencies`, `task_comments` | Phase 2 |
| **Trail** | `task_phase_history`, `activity_logs`, `outbox_events` | Phase 2 |
| **Health** | `project_health_snapshots` (score, verdict, five dimensions, one row per project per day) | Phase 8 |
| **Files** | `attachments` (bucket, path, size, mime, checksum — bytes live in a private bucket) | Phase 7 |
| **Automation** | `automations`, `automation_runs`, `notifications`, `notification_preferences` | Phase 9 |
| **AI** | `ai_conversations`, `ai_suggestions` (with a confirmation state) | Phase 12 |

**Identity before authentication.** Every business table carries `created_by`, and `workspace_members` needs a `user_id` — both in Phase 2, a phase before Better Auth is wired. So the identity *tables* are part of the first migration and Phase 2's seed writes one fixture user into them; what Phase 3 adds is the library, the session and the DAL that turns a session into a `TenantContext`. Until then, Phase 2's repositories receive a context assembled directly by the seed and by tests, which is also how they stay testable afterwards.

### 4.2.1 What each role may do

`role` travels in every `TenantContext`, so it needs a definition, not an adjective:

| | Read | Write tasks | Manage projects | Manage columns | Moderate comments | Invite / remove members | Delete workspace |
|---|---|---|---|---|---|---|---|
| **owner** | ● | ● | ● | ● | ● | ● | ● |
| **admin** | ● | ● | ● | ● | ● | ● | — |
| **manager** | ● | ● | ● | ● | ● | — | — |
| **member** | ● | ● | — | — | — | — | — |
| **viewer** | ● | — | — | — | — | — | — |

Everybody edits and deletes their own comments. Deleting somebody else's is moderating the project it was said in, so it goes with *Manage projects*.

Inviting grants a role, and nobody grants more than they hold: an owner or an admin may invite an admin, a manager, a member or a viewer, and no invitation ever grants *owner* — there is one per workspace, and a transfer, when there is one, is its own act. An invitation belongs to the address it was sent to, and the database does the joining itself (ADR 0003).

Roles are workspace-wide in v1. Per-project grants — the scoped client access of §6.5 — need a `project_shares` table and are deliberately out of the MVP.

### 4.3 The columns that carry the domain

The engine in §3 only works if the schema records the right things. These are not incidental fields:

- **`tasks.start_date` and `tasks.due_date`.** Due date drives Punctuality; start date makes calendar and timeline views possible later without a migration. Both exist from the first migration even though the MVP only reads one.
- **`projects.start_date` and `projects.due_date`.** Without them there is no Pace dimension — the project simply reports on four.
- **`tasks.blocked_at` and `tasks.block_reason`,** rather than a bare boolean: Flow needs to explain itself, and "blocked since the 14th" is a different sentence from "blocked".
- **`task_phase_history(task_id, from_column, to_column, at, by)`.** This table is not an audit nicety — Freshness reads days-in-column from it, and the phase-history consolidation of §3.8 is written against it.
- **`tasks.position` as a fractional index** stored as `text` (base-62 midpoints, not floats — doubles run out of precision after about fifty insertions between the same two neighbours). Moving a card writes one row. Every such column is declared **`COLLATE "C"`**: the default collation sorts alphabetically and case-insensitively, which puts `l` before `V` and scrambles the order the keys encode. Found by a reorder test, not by reading.
- **`tasks.number`,** the `TSK-N` per project, unique on `(project_id, number)` and assigned in the same transaction as the insert.
- **`tasks.priority`,** defaulting to `medium`, present from the first migration even though the interface only exposes it in Phase 7 — the health weights read it from Phase 1 and an absent priority would make them undefined.
- **`tasks.parent_task_id`,** nullable. A subtask is a task with a parent: it can be assigned, moved and blocked. A checklist item is not a task and never becomes one — it is a tick inside a task. Keeping the two apart is what stops the Phase 9 rule action "create a subtask" and the Phase 12 breakdown from meaning two different things.
- **`board_columns.position`,** the same fractional index as tasks, with the column id as the tie-break so the phase-band split of §3.2 is deterministic.
- **`board_columns.phase`,** constrained to `planning · execution · review · done`. Everything the progress engine does derives from this column and the board order — never from a name or an id.

### 4.4 Invariants the database enforces on its own

Application code is where rules live, but a handful of them are cheap to guarantee in the schema and expensive to discover in production:

- at most one `planning` and one `done` column per project — a partial unique index; *existence* is the creating service's job, which writes both columns in the same transaction as the project (a unique index can forbid a second one, it cannot require a first);
- `task_dependencies` unique on `(task_id, depends_on_id)`, with a check that the two differ (cycles longer than one hop are the domain's job, §3.7);
- `workspace_members` unique on `(workspace_id, user_id)`;
- `project_health_snapshots` unique on `(project_id, date)`, which makes the daily job idempotent;
- `outbox_events` carries a dedupe key, so a retried publish cannot fire an automation twice.

### 4.5 The event table

`outbox_events` is written **in the same transaction as the mutation that caused it** — that is the entire point. A task move either persists and emits `task.moved`, or neither happens. Until Phase 9 its only consumer is the activity feed; notifications and automations join in Phase 9, webhooks and digests in Wave 3, the assistant in Phase 12. All of them read the same rows, which is why the table exists in Phase 2: adding a bus later means reopening every service that ever wrote anything.

```
outbox_events(id, workspace_id, type, payload jsonb, occurred_at, processed_at, attempts, dedupe_key)
```

**Who drains it.** A queue nobody reads is a table that grows: sixteen events had piled up with no activity row to show for them. Every Server Action that mutates now calls `dispatchSoon()`, which runs the dispatcher through Next's `after()` — once the response is already on its way, so nobody waits for it. Phase 9's scheduler is then what it should have been from the start: the retry path for what failed, not the only path.

Event types the MVP emits: `task.created`, `task.moved`, `task.blocked`, `task.unblocked`, `task.completed`, `task.assigned`, `checklist.completed`, `comment.added`, `dependency.resolved`, `project.health_changed`, `member.invited` — and, from the clock, `task.due_soon`, `task.overdue` and `task.stalled`, at most one per task per day.

Every event carries its provenance: `actor_kind` and `actor_id` (§4.6), and — when an automation caused it — `caused_by`, the event the rule was reacting to, and `depth`, how many rules stand between it and a person's act. The engine refuses to fire past depth 3, which is what makes a rule that triggers a rule countable rather than infinite.

Two of them are derived, and the transaction that knows emits them: a move into `done` writes `task.moved` **and** `task.completed`, and then `dependency.resolved` for every task that was waiting on the one just finished and now waits on nothing. `member.invited` is written once the invitation has actually been delivered — an invitation that could not be sent leaves no row and no event. `project.health_changed` arrives with the snapshots in Phase 8.

### 4.6 Actor, and why automation never signs as a person

`activity_logs` records an actor kind — `user`, `automation` or `ai` — beside the actor id. An action taken by a rule reads as *"Automation: due date passed"*, never as the name of whoever happened to own the workspace. Automation disguised as a person destroys trust in the record, and the record is what this product sells.

### 4.7 Migrations and seed

Migrations are generated from the schema, reviewed as SQL and committed. Against a local database they are applied by the CLI; against any deployed database — which first exists in Phase 3 — they are applied by the pipeline and never by hand.

The seed is deterministic in the strict sense: **fixed ids and a frozen clock**. Ids are literal UUID v7 values pinned in the fixture, and every timestamp is derived from a seed epoch constant rather than `now()`, so "the seed rebuilds the identical state on every run" is a claim a test can make. Its content: one workspace, two projects, about twenty tasks spread across phases with blocks, dependencies and dates chosen so that every health dimension has something to say. It is the fixture the integration tests and the `/dev` routes both consume — and `/dev` routes exist only outside production builds.

### 4.8 Decisions taken

Settled, like §3.10. The rejected column records what was weighed.

| | Decision | Taken | Rejected |
|---|---|---|---|
| D5 | Soft delete | `deleted_at` on `projects` and `tasks` only | Everywhere (audit-friendly, query-hostile) or nowhere |
| D6 | Ordering key | Fractional index as text | Integer positions with column-wide reindexing |
| D7 | Enumerations | `text` + check constraint | Postgres native enums |
| D8 | Health snapshots | One row per project per day, from Phase 8 | Computed on read only, no history (kills the trend line) |

## 5. Stack and tooling

Each row is the decision in force. Several carry a fallback if the choice disappoints — Better Auth, the email provider, the local stack — and §9 records what the fallback is; that is a contingency, not an open question.

| Layer | Choice | Why |
|---|---|---|
| Framework | Next 16.3 · React 19.2 · TypeScript strict | App Router with Server Components and Server Actions; Turbopack by default |
| Runtime | Node 20.9+ · pnpm | Framework minimum; pnpm for a strict, fast store |
| Database | **Supabase Postgres** · Drizzle ORM | Managed Postgres with Storage in the same product; Drizzle keeps the schema in TypeScript and the migrations in reviewable SQL |
| Access | Postgres wire protocol through Supabase's pooler, transaction mode, prepared statements off | Drizzle talks to Postgres, not to a REST layer — the Supabase JS SDK is used **only** for Storage |
| Auth | **Better Auth** with the Drizzle adapter | Sessions in our own database, tables in `public`, no third-party SDK in the client |
| Email | Resend in production · a local inbox in development | Account verification, password reset and invitations need real delivery in Phase 3 |
| UI | Tailwind v4 (`@theme`) · shadcn/ui on Base UI · Lucide | Planora's tokens become theme variables; accessible primitives without rewriting them |
| Motion | CSS keyframes, no library | The Drop Catch bounce is thirty lines of CSS (`pln-bounce`); an animation library joins when a screen needs choreography, not before |
| State | `useOptimistic` + Server Actions | The server owns the data; the client holds a pending move until the revalidation lands. Phase 6 found no need for a client cache — TanStack Query joins the moment a screen fetches on its own. Ephemeral UI state is `useState`; a store joins when state has to outlive a component tree, which nothing does yet |
| Forms | `FormData` · Zod v4 | One schema per Server Action, parsed on the server and reused as the AI's structured output in Phase 12. React Hook Form joins with the first form whose validation has to run as the person types |
| Interaction | dnd-kit · Tiptap 3 | Kanban drag, and the task as an operational document |
| Charts | Recharts | Carried over from the v1 dashboard; the chart set here is small and it covers it |
| Tests | Vitest · Playwright | Unit on the domain, integration on the services, E2E on the critical flows |
| AI | `@anthropic-ai/sdk` · `claude-opus-5` | Server-side only, structured output validated by Zod, human confirmation before any write |
| CI/CD | GitHub Actions · Vercel | `pnpm verify` on every push; migrations applied by the pipeline, never by hand |

### 5.1 The local environment

Development runs against **Docker Postgres plus a filesystem storage adapter** — the fallback §9.1 anticipated, taken deliberately when the Supabase CLI stack proved too heavy for this machine. `server/storage/` is a port with three adapters: Supabase Storage, the filesystem, and memory for tests. The filesystem adapter signs its own URLs with the same secret Better Auth uses and serves them from `/api/files`, so an expiring signed URL behaves in development the way it behaves in production; only that folder knows the difference. Supabase is chosen automatically when its credentials are present, and a production build will not fall back to disk unless asked by name with `STORAGE_DRIVER=local`. Email is captured by a local inbox instead of being sent. `.env.example` is versioned; no secret ever is. The repository lives at `~/dev/planora`, for the reason given in §9.2.

### 5.2 What we deliberately do not add

- **No Storybook.** A `/dev/ui` route inside the app shows every primitive in every state, against the real theme, with no second build to maintain.
- **No GraphQL, no tRPC.** Server Actions already give end-to-end types across the boundary.
- **No CSS-in-JS.** Tokens plus Tailwind, or it stops being one design system.
- **No monorepo.** One deployable, one `package.json`, until there is a second consumer that actually exists.
- **No React Compiler, PPR or the new caching APIs in the MVP** (§2.5).

## 6. Product scope: MVP, post-MVP, and the SaaS layer

### 6.1 Who this is for

Planora is for anyone running a project they want to *see*: developers, agencies, freelancers, and people who simply want a visual grip on work in progress. That audience has one consequence that shapes every decision below.

**Single-player has to feel complete on day one.** Someone who signs up alone, creates one project and never invites anybody must get the whole product — board, progress engine, health audit, task documents, files, automations. Nothing of value may sit behind "invite your team first".

Multi-tenancy is therefore **structural, not a feature**. Workspaces, members and roles exist in the schema and in the authorization layer from the first migration, because retrofitting a tenant boundary into a populated database is a rewrite. But no MVP screen sells collaboration, and no flow requires a second human.

### 6.2 What the MVP is

The MVP is **Phases 0 through 9 complete** (§7). Its definition of done is behavioural, not a feature count:

> A real project runs from first task to delivery without leaving the app, and the numbers the app shows about that project are trustworthy.

Nine capability blocks make that true:

| Block | What ships | Phase |
|---|---|---|
| Project portfolio | Create, edit, complete, reopen; grid split by state; drag to reorder; deadline indicators (none / on track / late) with day counts | 5 |
| Kanban board | Phase-typed columns grouped by phase on the board (a new column is inserted beside the others of its phase), horizontal scroll with per-project memory, edge scrolling, drag with optimistic mutation | 6 |
| Drop Catch | Invalid moves refused on the client *and* on the server, by the same function | 1, 6 |
| Task as a document | Rich editor, checklists, dependencies, comments, internal notes, priority, dates, `TSK-N` numbering, shareable URL | 7 |
| Progress engine | Hybrid phase model (0 / 30–69 / 70–99 / 100), checklist micro-progress, adjusted progress, completion locks | 1, 8 |
| Health engine | Healthy / Attention / At risk / Critical from five normalized dimensions (flow, pace, punctuality, freshness, momentum), with bottleneck list, Top 2 and a daily trend | 1, 8 |
| Dashboard | Multi-project panel, progress and distribution charts, latest activity, contextual right sidebar | 8 |
| Files | Direct upload through a signed URL to a private bucket, attachment metadata, images dropped into the editor, global gallery | 7, 8 |
| Automations and notifications | Event-bus consumers: in-app inbox, transactional email, workspace rules (when / if / then), time-based routines, a visible run log | 9 |
| Settings | Theme (dark by default, light supported), hide-completed preference, profile, workspace export to JSON/CSV, and a Danger Zone that deletes a project or workspace behind typed confirmation | 8 |

Identity, personal workspace, invitations and transactional email arrive earlier, in Phase 3, because account verification and password reset need that plumbing anyway.

Two small things are folded into the MVP because they cost almost nothing once their phase is open: a **seeded example project** at signup instead of an empty screen, and a real **client record** attached to projects, replacing the v1 e-mail scanner. Both land in Phase 5.

### 6.3 Explicit non-goals for v1

Saying no here is what keeps Phases 0–9 finishable.

- **Billing, plans and usage limits.** Entirely out — no `plan` column, no Stripe, no metering. The workspace boundary is what makes this addable later without a data migration, and that boundary is enough for now.
- **Real-time multiplayer.** No presence, no live cursors, no collaborative editing. Optimistic mutation plus a refetch is sufficient for a product nobody is co-editing yet.
- **Native mobile apps.** The layout is responsive and narrow screens get a drawer; an installable PWA is post-MVP and native is not on the map.
- **Internationalization.** The interface is **pt-BR only**; code, schema, comments, commits and documentation are **English**. UI strings live in one module from day one, so a future locale is a translation rather than a hunt — but no i18n library ships in v1.
- **Custom fields per project.** Deliberately rejected: the classic entry point for scope creep, and it turns every query, filter and report into a dynamic-schema problem.
- **Public API and integrations.** Webhooks, API keys, importers and calendar feeds are post-MVP.

### 6.4 What we rebuild differently

The legacy feature list is preserved in full as *product intent*, but four of its items were artifacts of browser-local storage. Those get an honest equivalent instead of a faithful port.

| Legacy behaviour | What it actually was | v2 replacement |
|---|---|---|
| JSON backup export and local wipe | Dumping and clearing `localStorage` | Workspace export (JSON/CSV), plus a Danger Zone that deletes a project or workspace *in the database* behind typed confirmation |
| Client directory built by scanning e-mails | String matching over project fields | A real `clients` record linked to projects — the same record that later grants scoped client access |
| Users tab with team rename and avatar-by-URL | A decorative screen with no membership behind it | Real members and invitations from Phase 3; alone in a workspace you see one member and an invite button |
| "Prepared for AI" chat with simulated typing | A mock conversation | Nothing in the MVP. The assistant appears in Phase 12 with a real model, structured output and confirmation before any write |

Everything else in the legacy summary — the twenty feature sections and the ten mechanics that define the product — carries over unchanged in intent. Appendix A maps each legacy document to where its content now lives.

### 6.5 Post-MVP backlog

Ordered by value per unit of work, in the sequence I would actually build them.

**Wave 1 — makes a solo user come back daily**

1. **Project templates and duplication.** Repeatable work (client onboarding, a construction site, a sprint) stops being recreated by hand every week — the largest saving here for the least new machinery, since a template is a project read and written back.
2. **My Day.** A personal view cutting across projects: assigned to me, due, blocked or stale today. Everything in the MVP is project-centric; this is the view that pulls someone back in every morning.
3. **Global search.** Postgres full-text over projects, tasks and documents behind a keyboard shortcut. No new infrastructure to operate, but not free either: it needs a generated `tsvector` column and a GIN index per searchable table, which is one migration.
4. **Shareable progress report.** A link or PDF generated from the progress and health engines, for a client or a manager who will never log in. It is the cheapest way to put the health engine in front of someone who will not open the app.
5. **Client and guest access.** One project, read-only, without joining the workspace. The `viewer` role of §4.2.1 is workspace-wide and does not express this, so it needs a `project_shares` table and a grant path of its own — more than plumbing, and the reason it sits after the four items above rather than inside the MVP.

**Wave 2 — depth on work that already exists**

6. **Recurring tasks and per-phase checklist templates.** Rides on the Phase 9 scheduler.
7. **Estimates and time spent.** Feeds stagnation detection in the health engine and gives the Wave 1 report real numbers.
8. **Alternative views: list, calendar, light timeline.** Unlocked by the `start_date` column the first migration already carries.

**Wave 3 — adoption and interoperability**

9. **CSV and Trello import.** Removes the cost of switching.
10. **iCal deadline feed.** Deadlines appear in the calendar the person already uses, through a signed read-only feed URL per workspace.
11. **Outbound webhooks and per-workspace API keys.** Consumers of the same event bus built in Phase 2.
12. **Installable PWA with quick capture.** Note a task from a phone, on site, offline, and let it sync.
13. **Audit trail export per workspace.** `activity_logs` already holds the data.

**Wave 4 — commercialization, once there are users to charge**

14. **Plans, limits, billing, admin panel.** Limits belong in the domain layer, next to every other rule.

### 6.6 The rule for adding anything to this list

The v1 failed by accumulating specification faster than behaviour: 3,786 lines of documents describing a product whose `src/` held 956 lines, 413 of them CSS. The guard against repeating that is one question, asked before any feature enters a phase:

> Which domain rule does it change, which test proves it, and which phase's definition of done does it move?

A feature that changes no rule and moves no criterion goes to the backlog above, not into the current phase. Anything a user cannot name after a week of using the product does not belong in v1 at all.

## 7. Delivery plan — phases 0 to 13

The order is negotiable in most places and non-negotiable in one: **the domain comes before the database, and the database comes before the screen.** A phase ends when a command proves it ended — not when it feels finished.

**Phases 0–9 are the MVP**: at the end of 9 the product exists, is deployed to a private environment, and you use it for real work. **Phases 10–11** are what make it safe to hold somebody else's data. **12** adds the assistant, **13** is the loop that follows.

---

### Block A — Foundation
*Nothing here is visible to a user, and everything here decides the rest.*

#### Phase 0 · Repository foundation

- Git from the first commit, pnpm, Next 16 with strict TypeScript and `noUncheckedIndexedAccess`
- ESLint 9 flat config with the `domain/` boundary rule; Vitest and Playwright wired
- Docker Compose for Postgres and the local inbox, and a versioned `.env.example` — the Supabase CLI stack was the first choice, and §5.1 says why it was not kept
- GitHub Actions running `pnpm verify` — typecheck, lint, test, build
- A `CLAUDE.md` under 100 lines and `docs/adr/0001-architecture.md`

> **Done when** `pnpm verify` passes in CI on a repository that still does nothing.

#### Phase 1 · Pure domain

- The five modules of §3, written with no database, no React and no Next
- All five health dimensions, including Pace and Momentum, against injected inputs
- Fixtures in `fixtures/`, importable by tests and by the dev routes

> **Done when** the suite covers every case in §3.9 — including scale invariance, the 99 ceiling, the insufficient-data verdict and the hysteresis rule.

#### Phase 2 · Persistence and events

- Drizzle schema — including the identity tables, so `created_by` and `workspace_members.user_id` have something to point at — first migration, and a deterministic seed with pinned ids and a frozen clock (one fixture user, one workspace, two projects, ~20 tasks with blocks, dependencies and dates)
- Repositories taking `TenantContext`; services opening transactions and calling the domain
- Composite tenant foreign keys and the invariants of §4.4
- **Outbox events written in the mutation's own transaction**, with the dispatcher and the activity-feed consumer

> **Done when** an integration test proves the service refuses to move a blocked task into `done`, the seed rebuilds the identical state on every run, and one move leaves exactly one `task.moved` row in `outbox_events` (a move into `done` also leaves the `task.completed` it implies — see §4.5).

#### Phase 3 · Authentication, tenancy and email

- Better Auth with email and password; a personal workspace created at signup
- The DAL: `requireSession()` and `requireWorkspace()`, both `server-only` and memoized per render
- `proxy.ts` doing nothing but redirecting unauthenticated visitors
- Transactional email plumbing — verification, password reset, workspace invitation — with versioned templates and a local inbox
- **First deployed environment**: a managed Supabase project and a Vercel deployment, because verification and invitation links need a real URL. Migrations run from the pipeline from this phase on. It is **private until Phase 11** — your own account and nobody else's data, since rate limiting, RLS and the security headers land in Phase 10

> **Done when** a forged request carrying someone else's `workspaceId` returns 404, the signup-to-empty-project E2E passes, an invitation arrives in the local inbox, and the same flow works on the deployed URL.

---

### Block B — Product
*From here every phase ships a usable screen over real data.*

#### Phase 4 · Design system and shell

- Tokens from the legacy `UI specs/` ported to CSS variables and Tailwind v4 `@theme`
- Primitives: Button, Badge, Dialog, Popover, Select, Calendar, Avatar, Toast, Empty state
- The responsive tri-pane shell at the measurements the legacy `planora_ui_guidelines.md` already fixes: a 238px left rail, a fluid centre, a 338px right pane, 300px board columns
- Its collapse rules, since 238 + 338 leaves no centre on a phone: below 1280px the right pane becomes a drawer; below 1024px the left rail collapses to icons; below 768px both are drawers over a full-width centre
- Dark is the default theme and light is supported — the v1 shipped a toggle and it stays
- `/dev/ui` showing every primitive in every state

> **Done when** lint refuses a raw hex value inside `components/`, and the shell renders with no horizontal overflow and no overlapping panes at 1440, 1280, 1024, 768 and 390px, in both themes.

#### Phase 5 · Projects and clients

- CRUD, grid split between active and completed, drag to reorder, deadline indicators with day counts
- Validation before completing a project that still has open work; reopening by drag
- The `clients` record, linked to projects
- A seeded example project at signup instead of an empty screen

> **Done when** an E2E creates a project, is refused when completing it with a blocked task, reopens a completed one, and a fresh signup lands on a populated board.

#### Phase 6 · Kanban

- Board rendered on the server with a client island for the drag
- dnd-kit with the fractional index, the move applied optimistically with `useOptimistic` and confirmed by the Server Action
- **Drop Catch** consuming `canMoveTask()` on the client and in the service
- Dynamic columns typed by phase, edge scrolling, per-project scroll memory

> **Done when** dragging a blocked task into `done` bounces without touching the network, the same move forged as a direct request is refused by the server, and a card moved between two neighbours writes exactly one row.

#### Phase 7 · The task as a document

- Intercepted route for the detail view, with a shareable URL
- Tiptap editor, checklists, dependencies, comments, internal notes, priority, dates, `TSK-N`
- **Everything an editor writes is sanitized on the server** against an allowlist before it is stored — the body, the notes and the comments are all HTML from a browser we do not control
- Attachments: direct upload through a signed URL to a private bucket, images dropped into the editor
- Automatic phase history consolidating the previous phase's notes into the body

> **Done when** changing phase archives the previous phase's notes under a labelled section and clears the field, and an attachment's URL expires and is re-signed only after a workspace check.

#### Phase 8 · Dashboard, health surfaces and files

- Multi-project dashboard, progress and distribution charts, latest activity
- The contextual right sidebar: adjusted progress, the five health dimensions, bottlenecks, Top 2
- Daily health snapshots and the trend line — `At risk, worsening for 5 days`
- Assignees: who a task belongs to, on the card and in the document — `task_assignees` has waited since Phase 2
- The global files gallery grouped by project
- Settings: theme, hide-completed, profile, workspace export to JSON/CSV, and the Danger Zone behind typed confirmation

> **Done when** every number on screen comes from `domain/health` or `domain/progress` — no calculation in a component — and a project with no dates shows four dimensions instead of a fabricated fifth.

#### Phase 9 · Automations, notifications and scheduling — *MVP ends here*

- Queue and job state inside Postgres itself. The clock comes from outside it — `pg_cron` where the Supabase plan offers it, otherwise a Vercel Cron hitting the scheduler route handler every minute; both call the same dispatcher, and neither is new infrastructure to operate
- In-app inbox and email per event type, with per-person preferences and a daily or weekly digest
- The workspace rule engine: `when <event> · if <condition> · then <action>` — assign, move, comment, create a subtask, change priority, notify
- Time-based routines: deadline approaching (default 2 days), deadline passed, stalled in a column beyond its phase threshold (§3.5, default 14/7/5 days), project entering `Critical`
- **Idempotent execution**: an automation run is keyed on `(event_id, automation_id)` with a unique index, so a retried delivery re-sends the notification without re-running the action, and no event fires the same rule twice
- A cap of 10 actions per event and loop detection, so a rule that triggers a rule cannot run away
- A run log the user can read: what fired, what the rule did, what failed

> **Done when** a rule created in the interface fires from a real board event, the effect appears in the history authored by the automation, and a delivery failure retried three times leaves exactly one row in `automation_runs` and one side effect.

---

### Block C — Scale
*Only after the core stands up and is tested.*

#### Phase 10 · Hardening

- RLS as the second barrier: a scope opened at every entry point, reads included; policies resolving the transaction-local setting through a membership check rather than trusting it; `FORCE ROW LEVEL SECURITY` on every business table; the application connecting as a non-owner role without `BYPASSRLS` and without a grant on the identity tables; a separate system role for the four cross-workspace paths; and migrations still running as the owner
- Rate limiting on write actions — 60 per minute per user, 10 per minute for invitations and password resets — complete `activity_logs` coverage, CSP and security headers
- A restore drill: a backup actually restored into a scratch database

> **Done when** a test connecting as the application role, with the tenant check in the service stubbed out, still cannot read another workspace's rows — and its companions show that naming a workspace you are not a member of buys nothing, that a statement sent outside a lane is refused rather than silently empty, and that every table in `public` outside the four identity tables carries `FORCE ROW LEVEL SECURITY` and a policy. The gate is the `database` job in CI; `pnpm verify` never reaches Postgres.

#### Phase 11 · Launch readiness

- A preview environment per pull request, with its own migrated database
- Error tracking, and a performance budget the pipeline enforces on the board and dashboard routes: LCP under 2.5s and INP under 200ms on a mid-range laptop profile, with the board's initial payload under 250KB compressed
- Accessibility pass: keyboard path through the board, focus order, contrast against the earthy palette
- The full E2E suite running against the preview before merge

> **Done when** a push opens a preview with a migrated database and the suite passes on it before the merge button is available.

#### Phase 12 · AI assistant

- Context builder fed by DTOs — the model never sees a raw database row
- Structured output validated by Zod: task suggestions, risk reads, board audit, breaking a task into subtasks
- Every suggestion becomes a preview; only a confirmation writes, and the entry is authored by `ai`

> **Done when** breaking a task down produces subtasks in preview and nothing is persisted before the confirmation click.

#### Phase 13 · Continuous evolution

- Wave 1 of the backlog in §6.5, in order
- Health weights tuned against real snapshots instead of guesses
- Each new rule arriving as a domain test first

> **Done when** a pull request changes a weight or a threshold in `domain/health` and cites the snapshot rows that justify it, with the affected tests updated in the same commit.

---

### 7.1 The shape of a phase

One phase, one branch, one pull request. A phase that cannot be reviewed in one sitting is two phases. No phase begins while the previous one has a red test or a broken typecheck, and no definition of done is ever an impression — it is a command, a test name, or a request that must fail.

Each "Done when" above is prose until the phase opens; the first commit of a phase turns it into **named tests**, and the pull request description lists them against the sentence they came from. That translation is the phase's contract: if a criterion cannot be written as a test, the criterion is wrong and the plan changes with it (§8.5).

## 8. How we work

This project is built by one person and a set of coding agents, with no deadline. That combination has exactly two failure modes: work that stops mid-phase and is unrecoverable weeks later, and agents that invent architecture because nothing told them what already exists. Everything in this section exists to prevent one of those two.

### 8.1 The rules

- **The phase rules of §7.1 apply here** — one phase, one branch, one pull request, and `pnpm verify` green before the next one opens.
- **Specification becomes a test, not a paragraph.** A rule with no test is a rule that does not exist.
- **Sample data lives in `src/fixtures/`**, imported by tests and by the `/dev` routes. Never inside a component.
- **Commits and code in English**, interface strings in pt-BR (Appendix B). Conventional commits, so history stays readable.

### 8.2 The three documents that agents read

| File | Length | Purpose |
|---|---|---|
| `AGENTS.md` | under 100 lines | Only what changes an agent's behaviour: the boundary rules, the verify command, where things go. `CLAUDE.md` is one line pointing at it, because Next regenerates a managed block at the top of `AGENTS.md` and two copies of the same rules would drift |
| `docs/adr/NNNN-*.md` | ~15 lines each | One architectural decision per file: context, decision, consequence. ADR 0001 records the architecture this plan chose; every later one is written when a rule is discovered, never in advance |
| `docs/DEVELOPMENT_PLAN.md` | ~900 lines | This document. Read the relevant section before writing code in that area |

There is no `frontend_context.md` / `database_context.md` / `backend_context.md` triad this time. Three parallel memory files drift out of sync with each other and with the code, and keeping them current costs more attention than they return. Their job is done by ADRs (decisions) plus the status file below (position).

### 8.3 The status file

`docs/STATUS.md` is the answer to *"I have not touched this for a month, where was I?"* — and it is deliberately tiny:

```
Current phase · what is done · what is next · decisions taken since the plan · what is blocked
```

It is updated at the end of every phase and whenever a session stops mid-phase. It never grows past a screen; anything longer belongs in an ADR or in this plan.

### 8.4 What an agent does before writing code

1. Read the section of this plan that covers the area, and any ADR it references.
2. Inspect what already exists — services, repositories and domain modules are reused, not duplicated.
3. Put the rule in `domain/` if it is a rule; a React component is never where a rule lives.
4. Add or update the test that proves the behaviour.
5. Run `pnpm verify`.
6. If a new rule, edge case or constraint was discovered, write the ADR before opening the pull request.

### 8.5 When the plan is wrong

It will be, somewhere. The response is not to work around it silently: change the plan in the same pull request that changes the code, and say so in the description. A plan that disagrees with the codebase is worse than no plan, because it is trusted anyway.

## 9. Risks and deferred decisions

| Risk | Where it bites | Mitigation |
|---|---|---|
| **Better Auth is young** | Phase 3 | Plan B is Auth.js. The DAL exists precisely so that swap does not leak past `server/auth/` |
| **Connection limits with a serverless runtime** | Phase 2 onward | Drizzle connects through Supabase's pooler in transaction mode, with prepared statements disabled — a detail that is cheap now and a production incident if discovered later |
| **Health weights are guesses** | Phases 1 and 13 | They are constants in one module, tuned in Phase 13 against real snapshots. The shape of the model is what matters; the numbers are knobs |
| **Automation becomes noise** | Phase 9 | Grouping by period, digests instead of individual messages, a cap on executions per event, and loop detection in the engine — from the first day, not after the first complaint |
| **AI writing automations** | Phase 12 | It proposes; a person approves; the rule is then an ordinary object. Suggesting is useful, self-executing rules written by a model are two risks stacked |
| **Backlog creep** | Always | §6.6: which rule does it change, which test proves it, which definition of done does it move |
| **Solo maintainer, no deadline** | Always | Phases sized to finish in a session or two, and `docs/STATUS.md` so a cold restart costs minutes |
| **No realtime** | Phase 6 onward | Accepted: two tabs can hold stale views. Revisit only when a second person actually uses a workspace |
| **Glossary drift** | Phase 4 onward | Interface pt-BR, code English: one strings module, and Appendix B as the dictionary |
| **shadcn/ui on Base UI** | Phase 4 | The Base UI distribution is newer than the Radix one and may not cover every primitive Phase 4 needs. Fallback: take that component from Base UI directly, or keep the Radix variant for it — the tokens are ours either way |
| **A new table arrives without a policy** | Phase 10 onward | The barrier is only as complete as its last migration. A catalog test asserts that every table in `public` outside the four identity tables has `relrowsecurity`, `relforcerowsecurity` and at least one policy. It runs in the `database` job of CI — `pnpm verify` never reaches Postgres |
| **Stale thresholds tuned on one user** | Phase 13 | Every default here was chosen from reasoning, not measurement. The snapshots are what turn them into evidence, and until then a wrong threshold shows up as a badge you disagree with |

### 9.1 Decisions deliberately deferred

- **Where notification email is sent from** — Resend is the default, Postmark the alternative. It is one adapter behind an interface, so the choice stays cheap until Phase 3.
- **Whether the local stack survives contact with the machine.** §5.1 chooses the Supabase CLI stack for Storage parity; if it proves too heavy on this hardware, the fallback is plain Docker Postgres plus a filesystem storage adapter, and only `server/storage/` notices.
- **Where the health constants become configurable.** The stale thresholds (14 / 7 / 5 days), the dimension weights and the ceiling rungs are fixed constants in `domain/health` for the whole MVP. Whether they later become *project*-level or *workspace*-level settings is a Phase 13 question, answered with snapshot data rather than now.
- **Billing, plans and limits** — out of v1 entirely (§6.3). Wave 4, and only with users to charge.
- **Realtime collaboration** — the schema already tolerates it; implementing it now would delay the core with nobody to collaborate with.

### 9.2 Two environment constraints that are not negotiable

- **Nothing under OneDrive.** File syncing locks files on Windows and degrades every build that touches `node_modules`. The repository lives at `~/dev/planora`.
- **The legacy directory is read-only.** `C:\Users\henri\.antigravity\Planora` is a requirements source and an asset library. Code is never edited there again, and nothing is imported from it except tokens and assets. Sessions opened *in* that directory — it is where this plan was written — do their work in `~/dev/planora` and write nothing back.

## 10. Next step

Phase 0, in one session. At the end of it there is a repository that does nothing yet and already guarantees everything.

1. **Create the repository** at `~/dev/planora`, with Git from the first commit.
2. **Scaffold Next 16** with strict TypeScript, Tailwind v4 and the folder shape of §2.6 — empty, but with the `domain/` boundary rule already active.
3. **Bring up the local database** (Supabase CLI stack) and version `.env.example`.
4. **Green CI** running `pnpm verify` — typecheck, lint, test, build.
5. **Copy tokens and assets** from the legacy directory — `UI specs/extracted_tokens/`, `UI specs/extracted_components/`, `src/styles/tokens.css`, and the icons and backgrounds under `public/` — which becomes read-only from that moment.
6. **Write `CLAUDE.md` and ADR 0001.** This plan already lives at `docs/DEVELOPMENT_PLAN.md`; the repository is created around it.

Then Phase 1, which is where the product actually starts: the progress and health engines, as pure functions, with their tests — before a single screen exists.

## Appendix A — Legacy documents and where their content went

The legacy directory is `C:\Users\henri\.antigravity\Planora`, read-only from Phase 0 on.

| Legacy document | Lines | Where its content lives now |
|---|---|---|
| `Mark_Downs/planora_arquitetura_instrucional.md` | 1,494 | §2 (layers, tenancy), §4 (tables), §5 (stack). Its folder tree is superseded by §2.6 |
| `Mark_Downs/planora_development_plan_fluxograma_contextos.md` | 1,481 | §7 (phases). Its three context-memory files are replaced by ADRs plus `docs/STATUS.md` (§8.2) |
| `Mark_Downs/planora_resumo_funcionalidades.md` | 536 | §6 by reference — the source of the MVP capability blocks and the backlog waves; kept as the requirements record and the E2E case list |
| `Mark_Downs/Protocol.md` | 142 | §2.2 (boundaries), §2.4 (tenancy), §4.4 (invariants), §8 (discipline). The forbidden-patterns list becomes lint rules, not prose |
| `Mark_Downs/logica_de_progressao.md` | 31 | §3.3 and §3.4 verbatim in intent; §3.5 supersedes its health model |
| `Mark_Downs/planora_ui_guidelines.md` | 102 | Phase 4, as Tailwind `@theme` tokens |
| `UI specs/` (tokens, component specs) | — | Copied into the new repository in Phase 0 |
| `src/` | 956 | Reference only. Nothing is imported from it except tokens and assets |

Nothing in that directory is authoritative once this plan exists. Where they disagree, this document wins.

## Appendix B — PT-BR interface glossary

The interface is pt-BR; identifiers, database values, comments and commits are English. Every user-facing string lives in one module — `src/lib/strings.ts` — and this table is the dictionary that keeps the two sides from drifting.

| Interface (pt-BR) | Code / database |
|---|---|
| Espaço de trabalho | `workspace` |
| Membro · Convite | `member` · `invitation` |
| Dono · Admin · Gerente · Membro · Visitante | `owner` · `admin` · `manager` · `member` · `viewer` |
| Cliente | `client` |
| Painel | `dashboard` |
| Projetos | `project` |
| Quadro | `board` |
| Coluna · Fase | `column` · `phase` |
| Planejamento · Execução · Revisão · Concluído | `planning` · `execution` · `review` · `done` |
| Tarefa | `task` |
| Item de checklist | `checklist_item` |
| Dependência | `dependency` |
| Travada | `blocked` |
| Atrasada · Estagnada | `late` · `stale` |
| Prioridade: Alta · Média · Baixa | `high` · `medium` · `low` |
| Notas desta fase | `internal_notes` |
| Histórico de fase | `phase_history` |
| Progresso bruto · ajustado | `raw_progress` · `adjusted_progress` |
| Ricochete (movimento inválido) | `drop_catch` |
| Saúde do projeto | `project_health` |
| Fluxo · Ritmo | `flow` · `pace` |
| Pontualidade · Frescor · Impulso | `punctuality` · `freshness` · `momentum` |
| Subtarefa (tarefa filha) | `parent_task_id` |
| Evento · Fila de eventos | `event` · `outbox` |
| Saudável · Atenção · Em risco · Crítico | `healthy` · `attention` · `at_risk` · `critical` |
| Sem dados suficientes | `insufficient_data` |
| Gargalos · Top 2 | `bottlenecks` · `top_two` |
| Tendência: piorando · melhorando · estável | `trend`: `worsening` · `improving` · `steady` |
| Distribuição | `distribution` |
| Responsáveis | `task_assignees` |
| Anexos · Arquivos (galeria) | `attachment` · `files` |
| Configurações · Perfil · Tema | `settings` · `profile` · `theme` |
| Ocultar concluídos | `hide_completed` |
| Exportar (JSON · CSV) | `export` |
| Zona de perigo | `danger_zone` |
| Automação (regra) · Execução | `automation` · `automation_run` |
| Quando · Se · Então (gatilho · condição · ação) | `trigger` · `condition` · `action` |
| Ligada · Desligada | `enabled` |
| Executada · Falhou · Pulada · Laço | `succeeded` · `failed` · `skipped` · `loop` |
| Notificação · Caixa de entrada · Aviso | `notification` · `inbox` |
| Resumo diário · semanal | `digest`: `daily` · `weekly` |
| Prazo se aproxima · Prazo passou · Estagnada | `task.due_soon` · `task.overdue` · `task.stalled` |
| Relógio · Agendador | `scheduler` |
| Atividade | `activity_log` |

**The rule:** a pt-BR label never becomes an identifier, and an English enum value never reaches the screen unmapped. When a new concept appears, it enters this table in the same pull request that introduces it.
