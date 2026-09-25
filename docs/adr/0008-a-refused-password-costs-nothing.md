# 0008 — A refused password costs nothing

**Date:** 2026-09-25 · **Status:** accepted

## Context

The owner, trying to sign up in production, had almost every password refused
as leaked, and after a few tries the form said "Muitas tentativas seguidas.
Espere um minuto e tente de novo." A new person should be able to keep trying
until a password is accepted.

Three things combined:

- **Better Auth counts before the policy.** Its limiter runs when the request
  arrives, before the body is read and before our hook judges the password
  (`better-auth/dist/api/index.mjs`, the router's `onRequest`). It has no way
  to give a count back. Five refused passwords spent the five sign-ups a minute.
- **Its window restarts on every request.** The database limiter writes the
  time of each allowed request and resets only once a whole window passes
  without one (`api/rate-limiter/index.mjs`). A person who kept trying, less
  than a minute apart, never got out.
- **Any leak at all was a refusal.** The breach check refused a password the
  corpus had seen once, and most passwords a person invents have been seen
  once by someone. It also counted a padding line (`Add-Padding: true` answers
  with made-up suffixes counted zero) as a hit.

The design review found two more: the hook judged `newPassword ?? password` on
every path, and sign-up accepts extra keys and stores `password`, so a weak
`password` sent beside a strong `newPassword` was stored without being judged;
and the reset hook read `body.token ?? query.token` where the endpoint reads
`body.token || query.token`, so an empty token in the body hid the real one
from the name rule.

## Decision

**The policy is a domain rule.** `src/domain/passwords.ts` holds the shape
rules (8 to 128 characters, the blocklist, repeats and runs, the person's own
name and address) and the breach rule. The form runs the same function as the
person types; the server runs it before it stores anything.

**Refuse only what many people chose.** A password the corpus has seen ten
times or more is refused; fewer is accepted (the owner's decision of
2026-09-25). What a policy can defend at sign-up is online guessing, which
tries the most popular passwords first; ten appearances means many accounts
converged on the string and it sits in the wordlists built from the dumps. One
to nine is the long tail. The count is read from the exact line; padding, an
absent suffix and anything unparseable never refuse. When the corpus cannot be
asked, the password is accepted, as before.

**The sign-up allowance counts accounts, not attempts.** Planora's own fixed
window — five a minute per connection, `planora:signUp:<address>` — is spent in
the hook after the policy has accepted the password, keyed by the address
Better Auth's `getIP` resolves with the same options. A refused password throws
before it is counted, whether it came from the form or from a script. Better
Auth's own rule on `/sign-up/email` stays, at sixty a minute, as an outer bound
against scripts. A call from the server itself, with no request, is not
counted, as Better Auth does not count it.

**Cross-site sign-ups are refused before they cost anything.** Better Auth's
CSRF check for sign-up runs after our hook; without this, a hostile page could
spend its visitor's allowance. A same-origin form never sends
`Sec-Fetch-Site: cross-site`.

**The field checks as the person types.** A Better Auth plugin endpoint,
`POST /api/auth/password/check`, answers a password with a verdict and nothing
else: accepted, one of the refusals, or unavailable. It takes no name, address
or token and reads no table, so it tells nobody anything about an account. It is
an endpoint rather than a Server Action because Next runs a client's actions one
at a time and cannot cancel them. Better Auth limits it to sixty a minute per
address, apart from sign-up. The form asks half a second after the person stops
typing (at once after a paste), cancels a question the person has typed past,
remembers the last twenty answers, and never sends a password it knows is
refused. When the check cannot answer, the field says so and the submit decides.

**The hook judges the field each endpoint stores:** `password` at sign-up,
`newPassword` at reset and change, and the reset token is read the way the
endpoint reads it.

**The reset keeps its counted limit** of ten a minute. It guards the link's
token, and there the policy's answer depends on whose token it is, so a free
refusal would tell a caller whether a token is valid. The reset form gets the
same live field, without the name rule, which the server still applies at
submit.

**`DISABLE_BREACH_CHECK` cannot reach production.** The E2E switch now stops
the server from starting when `VERCEL_ENV` is `production`.

## Consequences

- A person can try passwords for as long as they like. The five-a-minute wall
  is reached only by five accepted sign-ups from one connection, which is what
  it was for: every accepted sign-up sends a message.
- A password seen one to nine times in breaches is accepted. If it is this
  person's own password from a breached site, the defence is sign-in's limit and
  confirmation by email (ADR 0007), not this rule.
- A good password with a malformed address spends one of the five: the hook does
  not second-guess Better Auth's own validation, because a disagreement between
  the two would be a way around the allowance.
- A refused password sent straight to `/sign-up/email` by a script is bounded
  only by Better Auth's sixty a minute. Each one costs, at most, one breach
  lookup and no write.
- A page on another site can still make its visitors' browsers spend Better
  Auth's own counters — the live check's sixty, with a plain-text POST it
  counts before refusing with a 415, and sign-up's outer sixty, with a form it
  counts before our hook refuses it. It could before, against a sign-up limit
  of five. The field then says it could not check, and the submit decides.
- The share of passwords the new threshold refuses cannot be measured from the
  development sandbox, which cannot reach the corpus. Nothing logs passwords or
  hash prefixes.

See ADR 0007 for confirming an address, and `docs/DEVELOPMENT_PLAN.md` §7
Phase 10 for the rate limits.
