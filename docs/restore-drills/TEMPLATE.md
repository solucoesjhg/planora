<!--
Copy this file, or let `pnpm db:restore-drill --record` write it for you: the
runner fills every {{placeholder}} it knows and leaves the rest for you. One
file per drill, committed — a drill nobody can point at did not happen. The
commands are in docs/DEPLOY.md §6.
-->

# Restore drill — {{date}}

| | |
|---|---|
| **Date** | {{date}} |
| **Run by** | *(who)* |
| **Source** | {{source}} |
| **Scratch database** | {{scratch}} |
| **Dump** | {{dump}} |
| **Took** | {{seconds}}s |

## What the automatic check said

**{{result}}**

- Tables compared: {{tables}}
- Rows compared: {{rows}}
- Migrations applied, in both: {{migrations}}
- Row-level security policies, in both: {{policies}}

## What was checked by hand

The row counts prove the data came back. These prove it is usable — open the
scratch database and answer each one:

- [ ] A person: `select email, email_verified from users limit 5;`
- [ ] A board: `select p.name, count(t.id) from projects p left join tasks t on t.project_id = p.id group by 1;`
- [ ] The phase history of one task, which is what progress is computed from
- [ ] An attachment row, and whether the file it names is still in the bucket
- [ ] `pnpm exec drizzle-kit migrate` against the scratch database says there is
      nothing to apply

## What this restore did **not** bring back

*(Confirm each one, because none of them is in the dump.)*

- [ ] The Supabase Storage bucket's bytes — attachment rows point at files that
      are still only in the original bucket
- [ ] The `pg_cron` job that ticks the scheduler (`cron.job` lives in the
      `cron` schema, which is not dumped)
- [ ] Every Vercel environment variable, including `BETTER_AUTH_SECRET` — a new
      one signs everybody out and invalidates every unopened link
- [ ] Anything in Supabase's own `auth` and `storage` schemas

## What went wrong, and what changed because of it

*(The reason this file exists. A drill that found nothing is worth one line; a
drill that found something is worth the paragraph that stops it happening
during a real recovery.)*
