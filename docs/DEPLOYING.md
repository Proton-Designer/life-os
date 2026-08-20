# Deploying tracking-app to production

Three engineers independently hit the same two traps on 2026-08-20. Read this
before deploying; it takes less time than rediscovering them.

## Trap 1 — the Vercel CLI's login is the wrong identity

`tracking-app` is linked (via `.vercel/project.json`) to org
`team_65o9SgZtNBt9VgezWjY2npZH`. A plain `vercel deploy --prod` fails with
"Could not retrieve Project Settings" because the local CLI login resolves to
the `ayman-mohammed07` personal scope, which cannot see that project. Any
Vercel MCP tooling in the session may be authenticated to a *different company's*
org entirely — check before trusting it.

Do NOT re-link `.vercel/`, and do NOT create a new project to get around this.

Bypass CLI login with the token instead:

    set -a && . ./.env.local && set +a
    npx vercel@50.0.1 deploy --prod --yes --token "$VERCEL_TOKEN"

`VERCEL_TOKEN` lives in `.env.local`, which is gitignored. Never paste its value
into chat, a peer message, a memory file, or a committed file — reference the
variable, never the secret.

## Trap 2 — `vercel deploy` ships the working directory, not the commit

This repo is a shared working tree: several engineers edit it at once. `vercel
deploy` uploads whatever is on disk, so deploying from the shared tree ships
everyone's uncommitted, unreviewed, possibly half-finished work.

If `git status --short` is empty, deploying in place is safe. Otherwise deploy
from a worktree pinned to the exact commit:

    git worktree add /tmp/deploy-<sha> <sha>
    cp .env.local /tmp/deploy-<sha>/
    cd /tmp/deploy-<sha>
    npx vercel@50.0.1 deploy --prod --yes --token "$VERCEL_TOKEN"
    cd - && git worktree remove /tmp/deploy-<sha>

A worktree touches nothing in the shared directory. Never `git stash`,
`git reset --hard`, `git checkout -- <path>`, or `git clean` here to get a clean
tree — those mutate the directory other engineers are actively writing into.

## Verify after deploying

    curl -sI https://tracking-app-sand.vercel.app/login | head -1   # expect 200

`/` returning 307 is the normal unauthenticated login redirect, not a failure.
Confirm the alias actually moved to your deployment — `age: 0` and
`cache-control: no-store` mean you are seeing the new build, not a cached one:

    npx vercel@50.0.1 inspect <deployment-url> --token "$VERCEL_TOKEN"

## Migrations: code first, schema second

On 2026-08-20 migrations were applied to production hours ahead of the code
deploy, including a table drop — so production briefly ran code that read a
table no longer there. Where a change allows it, deploy code that tolerates both
schemas first, then migrate. Additive schema changes are safe in either order;
drops and renames are not.

## Concurrent deploys

More than one engineer may deploy the same afternoon. Before deploying, confirm
your commit descends from what is already live, or you will silently roll back
someone else's work:

    git merge-base --is-ancestor <live-sha> <your-sha> && echo "safe"
