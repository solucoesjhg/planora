# 0007 — An address is confirmed by whoever holds the mailbox and the password

**Date:** 2026-09-24 · **Status:** accepted

## Context

Better Auth confirms an address when its link is opened. The link is a signed
token naming the address and nothing else, so opening it confirms whatever
account carries that address, with whatever password that account was given.
The security audit of 2026-09-24 found how that ends.

**Somebody signs up first with another person's address**, and a password of
their own. They cannot sign in: the address is not confirmed, and the link
goes to a mailbox they do not hold. So they wait.

**The owner of the address signs up later.** Better Auth answers "ok" (it
answers every sign-up the same way, so that it does not tell a stranger which
addresses exist) and sends nothing at all, because the account already exists.
The owner waits for a message that never comes, and presses "Reenviar". That
sends a link — to the account the stranger created. The owner opens it, the
address is confirmed, and the stranger signs in with their own password to an
account the owner believes is theirs. Every invitation later sent to that
address lands in it.

The owner cannot sign in with the password they chose, and can take the
account back with "Esqueci minha senha". Until then it is the stranger's.

## Decision

**The link confirms nothing on its own.** It carries its token to the login
form (`/login?confirmar=…`), and the address is confirmed when that token
arrives together with the account's own password. A hook before sign-in
checks the token was issued for the address being signed in to, and checks
the password against the account, and only then marks the address confirmed;
sign-in then goes ahead as it would for any confirmed account. Anything else
leaves the account untouched and sign-in answers on its own.

The person holding the mailbox cannot type a password somebody else chose, and
the person who chose it cannot open the mailbox. Neither confirms the address
alone.

**Better Auth's own endpoint is closed.** A GET to `/verify-email` is turned
into the same login form before Better Auth's handler runs, so a link sent
before this decision still works the new way, and a mail scanner following a
link confirms nothing.

**A password reset confirms the address.** The reset link was delivered to the
mailbox and the new password is its holder's choice, which is everything
confirmation asks for. It is also how the owner of an address takes it back
from an account somebody else created with it: the stranger's password stops
working in the same step, and every session is revoked, as before.

**Sign-up with an address that already has an account tells the mailbox.**
The answer to the request stays the same for every address. The message says
the address already has an account, and that "Esqueci minha senha" sets a new
password and confirms the address. It greets nobody by name: the name on an
account nobody confirmed may be the stranger's choice.

**An unconfirmed account's owner gets a fresh link by signing in.** Signing in
with the right password to an account nobody confirmed sends a new link
(`sendOnSignIn`), so an expired link is not a dead end. The wrong password sends
nothing, so the login form cannot be used to fill somebody's mailbox.

## Consequences

- Nothing changes in the number of steps for an honest sign-up: the link used
  to land on the login form saying "confirmed, now sign in"; it lands on the
  same form, and signing in is what confirms.
- The login form now answers Better Auth's refusals in pt-BR: a wrong password
  with a confirmation link says how to set a new one; an unconfirmed address
  says a new link was sent.
- A stranger can still sign up with somebody's address. They get nothing from
  it, and the owner of the address is told when they try to sign up
  themselves. The account's name and its personal workspace keep whatever the
  first sign-up typed, and there is no profile page yet to change them.
- The message about an existing account is one more message a stranger can
  cause somebody to receive, under the same limit as the rest: five sign-ups a
  minute per address, as for a reset or a resend.
- The token names only the address, as before. A token and the right password
  confirm the account, within the token's fifteen minutes; it is not spent on
  use.

See ADR 0003 for why accepting an invitation checks that the address is
confirmed, and `docs/DEVELOPMENT_PLAN.md` §7 Phase 3.
