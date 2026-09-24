# 0006 — An attachment is what the store holds, checked against what was asked for

**Date:** 2026-09-24 · **Status:** accepted

## Context

Phase 7 made the bytes skip the application: the browser asks for a ticket,
declaring a type and a size, sends the file straight to the store, and then
asks the server to confirm. `confirmUpload` measured what landed and refused
what was too large. The security audit of 2026-09-24 found what it did not do.

**It never compared the type.** The allowlist was checked against the
declaration. The store records whatever `Content-Type` arrives with the
upload, and a Supabase signed upload URL does not bind one. So a ticket asked
for as `image/png` took an SVG, confirmation accepted it, and Supabase served
it inline from its own origin, script and all, to whoever clicked "Abrir".
The rule that says "no SVG: it is a document that can carry script" was a
check on a string the attacker wrote. Reproduced with the memory store. The
same held in development, worse: the filesystem route stored the header it was
sent and served it from the application's own origin, and a ticket could be
replayed after confirmation to replace a file with HTML.

**An upload nobody confirmed stayed forever.** Nothing measured it, nothing
removed it, and `linkFor` signed a link to it anyway. With sixty tickets a
minute and a bucket at Supabase's defaults (no type list, the project's global
size limit), one account could fill the project's storage without ever calling
confirm.

**Anybody who writes tasks could delete anybody's file**, and the bucket keeps
no backup.

## Decision

**The store's answer decides.** `domain/attachments` holds the list, the size
and one rule, `landedAsDeclared`: what landed is kept only when its media type
is on the list and is the one declared (parameters such as `charset` aside).
Anything else is taken out of the store and its row deleted, the same way an
oversized file already was.

**A link is signed only for what was kept.** `linkFor` refuses a `pending`
row as not found.

**The bucket refuses what the application would not keep.** An upload ticket
is issued only while the bucket restricts types to a subset of the list and
size to 25 MB or less. The adapter already asked the bucket whether it was
private; it now asks this too, and names the settings to change when the
answer is wrong. Links to files already kept do not wait on it.

**The clock sweeps abandoned uploads.** A `pending` row more than three hours
old (the store's ticket lasts two) loses its object and then its row, a batch
per tick.

**The filesystem store behaves like the bucket.** The upload's type is part of
its signature, the object is stored under the signed type rather than the
header, and a second upload to the same path is refused.

**Removing a file is the uploader's, or a manager's.** It follows §4.2.1's rule
for comments: your own, or moderation, which goes with *Manage projects*. The
task document only shows the button to whoever may use it.

## Consequences

- A file whose browser-reported type differs from what it sends is refused
  where it was once accepted. Browsers report and send the same `File.type`,
  so this costs an honest upload nothing.
- Until the bucket carries its limits, no new upload can be made in
  production. That is deliberate. It is a two-field change in the dashboard
  (`docs/DEPLOY.md` §1.2), and a bucket left at its defaults is the gap this
  closes.
- `/api/attachments/<id>` now reads the workspace the browser chose, as every
  page does. With only the first membership, a file in a second workspace was
  a 404 to its own members.
- Still open: deleting a workspace leaves its files in the bucket, and removing
  a file writes no event.

See ADR 0002 for why these functions open a scope per statement, and
`docs/DEVELOPMENT_PLAN.md` §7 Phase 7.
