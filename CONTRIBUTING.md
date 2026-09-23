# Contributing to Cortera Framework

Thanks for your interest in contributing! Cortera Framework (`@cortera/*` on npm) is an observability-first, agent-native web app framework. This guide covers how to get set up, propose changes, and what to expect from review.

## Before you start

Cortera Framework is a fresh v1.0.0 release. A few things worth knowing up front:

- **Known issues**: the CLI has a duplicate `keys` command bug (tracked in Issues — see or file under `bug`).
- **Test coverage gaps**: `@cortera/auth`, `@cortera/db`, `@cortera/adapter-next`, and `@cortera/guard-service` don't yet have test suites. Contributions that add coverage here are especially welcome.
- **No bundled dashboard**: admin UI (trace viewer, approvals inbox, live tail) is intentionally not shipped in core. `@cortera/guard-service` exposes an HTTP API instead. This is a deliberate scope decision, not an oversight — please open a discussion before proposing a bundled dashboard package.

## Project structure

This is a monorepo with the following packages:

| Package | Purpose |
|---|---|
| `@cortera/core` | Core primitives — Actions, routing, tracing |
| `@cortera/db` | Database client / provenance interfaces |
| `@cortera/auth` | Auth & API-key management |
| `@cortera/adapter-next` | Next.js 14 adapter |
| `@cortera/mcp` | MCP tool-schema generation |
| `@cortera/ui` | Headless UI primitives |
| `@cortera/guard-service` | Blast Radius, Auto-Containment, Taint Tracking, Behavioral Drift Detection |
| `@cortera/cli` | `cortera` dev CLI |

## Getting set up

```bash
git clone https://github.com/Cortera-space/Tera-v1.0.0.26.git
cd Tera-v1.0.0.26
npm install
npm run build
npm test
```

Some packages (`@cortera/db`) require a live Postgres instance for their tests — see that package's README for local setup.

## Making a change

1. **Open an issue first** for anything non-trivial (new features, architectural changes, new "aha" security features). Bug fixes and docs can go straight to a PR.
2. **Branch naming**: `type/short-description` (e.g. `fix/cli-keys-duplicate`, `feat/db-test-coverage`).
3. **Commit messages**: this repo uses [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope): description`. Examples:
   - `fix(cli): remove duplicate keys command`
   - `feat(guard-service): add test coverage for taint tracking`
   - `docs(readme): clarify adapter-next peer dependency`

   Do not include internal stage numbers or planning references in commit titles or PR titles — keep those, if relevant, in the PR description body only.
4. **Tests**: new functionality needs tests. If you're fixing a bug, add a regression test where practical.
5. **Run the full suite** before opening a PR:
   ```bash
   npm test
   ```

## Security-relevant changes

Cortera Framework's guard model (Blast Radius, Auto-Containment, Taint-Tracked Provenance, Behavioral Drift Detection) is core to its value proposition. Changes to `@cortera/guard-service` should:

- Include fuzz/invariant tests where applicable, not just unit tests
- Explain the threat model change in the PR description
- Flag any change that could weaken a default (e.g. widening what counts as low-risk) clearly in the PR title

## Pull request checklist

- [ ] Tests pass locally (`npm test`)
- [ ] New/changed behavior has test coverage
- [ ] Conventional Commit–formatted commits
- [ ] No internal stage numbers in PR title (description body is fine)
- [ ] Docs updated if public API changed
- [ ] `CHANGELOG.md` entry added under `Unreleased` (if this repo maintains one)

## Code of Conduct

Be respectful, assume good intent, and keep discussion technical. Harassment or abusive behavior toward maintainers or other contributors will result in a ban from the repo.

## Questions

Open a [Discussion](../../discussions) or an issue tagged `question`.
