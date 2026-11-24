# Epsilon Functions

Supabase Edge Functions (TypeScript on Deno) behind
[Epsilon](https://github.com/stuysu/epsilon). They do the work the browser
can't be trusted with: approvals, room reservations, strikes, invites and
sending email.

Each folder with an `index.ts` is one function, served at
`/functions/v1/<folder name>`. `main/` is the router used on the self-hosted
server: it checks the JWT (when `VERIFY_JWT=true`) and hands the request to
the right function. `calendar-feed` (opened by calendar apps) and
`export-voters` (checks the vote site's own token) skip that check. `_shared/` holds code used by several functions, for
example CORS headers (`cors.ts`), the service-role client (`supabaseAdmin.ts`),
the mail transport (`emailTransport.ts`), HTTP responses (`http.ts`) and
common helpers (`utils.ts`).

## Local development

See `docs/local-setup.md` in the site repo for running these against a local
Supabase stack, with Mailpit catching email.

Before you push:

```sh
deno fmt            # CI runs deno fmt --check
deno lint
deno check ./*/index.ts
deno test --allow-env   # unit tests: _shared/*_test.ts
```

CI (`.github/workflows/ci.yml`) runs the same four on every PR and on
`master`, with the Deno version pinned there.

## Deploying

**Merging to `master` deploys to production.** A GitHub webhook tells the
server to pull and reload the functions. There is no staging and no automatic
rollback; to undo, revert the merge on `master`.

So the CI check should be required before merging (Settings → Branches →
protect `master` → require the `check` status). If a release also needs a
migration, apply the migration first. See the site repo's
`docs/release-checklist.md`.

## Environment variables

Set on the server's edge runtime. A local `supabase functions serve` provides
the `SUPABASE_*` ones itself.

| Name                                                      | Used for                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                                            | API URL for the Supabase clients                                                                  |
| `SUPABASE_ANON_KEY`                                       | Client that acts as the calling user                                                              |
| `SUPABASE_SERVICE_ROLE_KEY`                               | Admin client in `_shared/supabaseAdmin.ts`                                                        |
| `SUPABASE_PUBLIC_URL`                                     | Optional: public API URL for storage links, when `SUPABASE_URL` is an internal address            |
| `NODEMAILER_HOST`, `NODEMAILER_PORT`, `NODEMAILER_SECURE` | SMTP server (`NODEMAILER_SECURE=true` for TLS)                                                    |
| `NODEMAILER_EMAIL`, `NODEMAILER_PASSWORD`                 | SMTP login                                                                                        |
| `NODEMAILER_FROM`                                         | From address on outgoing mail                                                                     |
| `SITE_URL`                                                | Links in emails, e.g. `https://epsilon.stuysu.org`                                                |
| `JWT_SECRET`                                              | `main/` router: verifies JWTs signed with this secret                                             |
| `SUPABASE_JWKS`                                           | `main/` router: optional JWKS (JSON) used instead of `JWT_SECRET`                                 |
| `VERIFY_JWT`                                              | `main/` router: `true` to reject requests without a valid JWT                                     |
| `NOTIFICATION_WEBHOOK`                                    | Optional, `export-voters`: Discord-style webhook told who exported                                |
| `VOTE_PUBLIC_KEY`                                         | `export-voters`: vote.stuysu.org's RS256 public key (PEM); the function refuses to run without it |
| `VOTE_JWT_ISSUER`, `VOTE_JWT_AUDIENCE`                    | Optional, `export-voters`: expected `iss` / `aud`, checked when set                               |

## Dependencies

Dependabot can't update Deno imports, only the Actions versions. Bump
`deno.json` imports by hand and commit the updated `deno.lock`.
