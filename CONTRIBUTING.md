# Contributing Guide -- Epsilon Functions

At this time, StuySU IT is **not** accepting external contributions.
The following documentation is meant for Directors.

As of 10/13/25, Epsilon functions are stored at `/srv/supabase/supabase/docker/volumes/functions` on the Supabase DigitalOcean server.

## Development Stack

[Supabase Edge Functions](https://supabase.com/docs/guides/functions) are
written in TypeScript for the Deno runtime.

## Editing Process

1. Write the code needed to add or enhance functionality.
   - Note that if you are duplicating code, it may be helpful to write a
     function in the `_shared/` directory.
2. Run `deno fmt`, `deno lint` and `deno check ./*/index.ts`. CI runs the
   same checks on every PR; don't merge until they pass.
3. Verify via `git diff` that you have made the correct changes, and commit
   the changed files to a branch.
4. Test any changed routes using a [locally hosted instance of Supabase](https://github.com/stuysu/epsilon/wiki/Hosting).
5. Once all routes and edited functions have been tested and CI is green,
   merge into `master`. A GitHub webhook will automatically tell the deployment
   on base.stuysu.org to pull and deploy the updated functions. If the change
   needs a migration, apply that first (database → functions → site).
