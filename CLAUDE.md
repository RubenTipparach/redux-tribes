# Fallen Tribes

Project rules live in **[GUIDELINES.md](GUIDELINES.md)** and apply to every change. Read
them before touching anything; the first one (no em dashes or en dashes, anywhere) is
enforced by CI and will fail the build.

Design and architecture: `docs/DESIGN.md` reconstructs the archived Unity game,
`docs/ARCHITECTURE.md` holds the ADRs for the rebuild.

## After every push, hand over both links

A push is not finished when git returns. It is finished when the change is visible and
the owner can watch it land. So end a push by pasting BOTH of these, every time, without
being asked:

- **Live:** https://redux-tribes.fly.dev/
- **Actions run:** the specific run for the commit just pushed, as
  `https://github.com/RubenTipparach/redux-tribes/actions/runs/<run_id>`

Pull the run id rather than guessing it: list the workflow runs for the branch and take
the one whose `head_sha` matches the commit that was pushed. Only if no run has appeared
yet, fall back to the branch filtered list and say the run has not started:

```
https://github.com/RubenTipparach/redux-tribes/actions/workflows/deploy.yml?query=branch%3A<branch>
```

Both links matter and neither substitutes for the other. The Actions link says whether
the change built and shipped; the live link is where it can actually be looked at. A
green run is not proof the site changed, and the site not changing is not proof the run
failed.

The deploy is only reached on pushes that CI passes, so a red run means the live site is
still serving the previous build. Say that plainly instead of pasting the live link as
though it carried the change.

## What is deployed, and where

One Fly machine in `ord` (Chicago) serves the TypeScript client AND the match API from
the same image, so the page and the API it talks to are always the same build. App name
is `redux-tribes` (`fallen-tribes` is the game's name, not the deploy target's).

`GET /healthz` reports the region and machine id it is running on, because `fly.toml`
describes intent rather than reality: `primary_region` only places NEW machines, so
config and the running machine can drift.

```
$ curl -sS https://redux-tribes.fly.dev/healthz
{"ok":true,"now":1787863861507,"region":"ord","machine":"18576452f77108"}
```

## Suites

All four must pass before a push:

```sh
node prototype/cli.js test                  # 18, the JS design reference
cd engine/sim_core && cargo test            # the Rust core (tests/, not the lib target)
npm --prefix web test                       # the wasm boundary
npm --prefix server test                    # the lockstep API
```

Determinism is checked, not assumed:
`NODE_PATH=/opt/node22/lib/node_modules node prototype/tools/xclient-check.js`.

`.github/workflows/deploy.yml` is one file with five jobs (`sim`, `prototype`, `api`,
`web`, `deploy`). Parse it with a YAML parser before pushing a change to it: an unquoted
colon-space inside a `run:` scalar has already broken it once.
