# 0004 — One act buys at most ten automated actions, and only members are told

**Date:** 2026-09-24 · **Status:** accepted

## Context

§7 Phase 9 promised "a cap of 10 actions per event and loop detection, so a
rule that triggers a rule cannot run away". The security audit of 2026-09-24
read what was built against that sentence and found that it held for one rule
and not for a workspace.

**The cap was per rule.** `evaluateRule` sliced each rule's actions to ten, and
a workspace could hold any number of rules on the same trigger. The depth guard
stopped a chain at three, but it bounded the chain's length, not its width.
`create_subtask` emits `task.created`, so a rule of ten subtasks on
`task.created` turns one new task into 10 + 100 + 1,000 tasks by depth three,
and ten such rules into about a million. All of it goes through the one outbox
that every workspace shares, and any account that signs up owns a workspace in
which it may write rules. Reproduced: one rule of four subtasks made 84 tasks
from one.

**`notify → user` reached anybody.** The recipient was checked to be a uuid and
nothing else. The dispatcher writes notifications on the system lane, where no
policy applies, and `automation.notify` is sent by email by default. So anyone
could have Planora's own domain email any account in the deployment their text,
and the first finding multiplied it. The `assign` action was never exposed,
because `assignTask` refuses non-members; `notify` had no equivalent check. The
same gap sat one layer down: `task.assigned` names its recipients in its
payload, and those ids were never checked either.

## Decision

**An act has an allowance.** An act is what a person did, or what the clock
did: an event at depth 0. Every event a rule causes carries the event it was
answering (`caused_by`), so every run can be traced up to the act at the root
of its chain. `MAX_ACTIONS_PER_ACT` is ten. Every run that act sets off, through
any rule, at any depth, is paid out of those ten. The plan's number stays; what
changes is what it counts. The per-rule limit of ten (`MAX_ACTIONS_PER_RULE`)
and the depth guard of three stay too, as the shape of a rule and the length of
a chain.

**The allowance is reserved when a run is claimed.** `automation_runs` gains
`chain_id` (the act) and `actions_granted` (what the act could still pay when
the run was claimed). A run is claimed inside a transaction holding an advisory
lock on its act, so a second dispatcher reaching a sibling event of the same act
reads what the first one reserved rather than the same total. Rules are served
in the order they were written: the earliest run whole, a later one runs cut
short, the rest are skipped. Both of the latter are written into the run log in
words, so an owner can see why a rule did less than it says.

**A workspace holds at most fifty rules.** With the allowance in place this is
hygiene rather than defence: every rule on a trigger is still evaluated, and a
skipped run is still a row. Fifty is more than any board uses.

**Only members are told, and only members may be named.** A rule naming someone
who is not in the workspace, in `assign` or in `notify`, is refused when it is
written (`not-a-member`), and re-checked when it is rewritten or switched back
on. Switching one off is always allowed. When a rule runs, `notify` tells only
the members among the people it names, whatever the rule says, which covers a
rule written before the check and a person who has since left. The same filter
sits under every notification the dispatcher writes: `recipientsOf` returns
members only, whatever the event's payload names.

## Consequences

- One click can cost at most ten automated actions, not 1,110 per rule. With the
  write allowance of sixty a minute, the worst any one person can make the
  engine do is six hundred actions a minute, all inside their own workspace.
- A workspace with several busy rules on one trigger will see the later ones cut
  short or skipped. That is visible in `/settings/automations`, and it is the
  price of the bound.
- Runs written before this change are filed under the root of their event by the
  migration, with nothing granted. They count for nothing, which is right: the
  acts they answered are long over.
- The outbox is still a single queue in the order events occurred. The
  amplification was what made that dangerous, and it is gone. Fairness between
  workspaces is a scaling question for later, not a security one now.
- The database still accepts a notification, an assignee or a preference row
  naming someone outside the workspace: the policies bind the workspace, not the
  person. The application no longer writes one. The composite foreign keys that
  would make the database refuse one belong with the barrier's per-command
  policies, which is the audit's last database change.

See `docs/DEVELOPMENT_PLAN.md` §7 Phase 9, and ADR 0002 for the system lane the
dispatcher runs on.
