# Contributing to Topos

Thanks for contributing to Topos. This document covers the branch flow,
commit rules, and what to verify before opening a pull request. For
architecture, service commands, and code style, read
[AGENTS.md](AGENTS.md) first — agents and humans follow the same rules.

## Branch flow

- Create a branch off `dev`, not `main` or `staging`.
- Use a descriptive, scoped name: `feat/add-user-directory`,
  `fix/pagination-cursor`, `chore/update-deps`.
- Keep branches small and focused on one change. Big changes are easier to
  review (and easier for agents to implement well) as a sequence of small
  PRs.
- Pull requests target `dev`.

## Commits

One-line commit messages in the imperative mood, no conventional-commit
prefix, under ~72 characters.

Good:

```
Add recommendation RPCs to the ai proto
Fix pagination cursor validation in content service
```

Avoid:

```
feat(ai): add recommendation RPCs
fix: pagination bug
WIP stuff
```

## Code style

Clean, simple, readable, maintainable code. No over-engineering, no
premature abstraction, no restating comments. Follow the idioms of the
service you touch; keep diffs focused. The full rules live in
[AGENTS.md](AGENTS.md) under "Code style".

## Verify before pushing

Run the relevant checks in the service directory (see the service matrix in
AGENTS.md for the exact commands):

- `ai`: `make test` + `make lint` (run `make integration` if you touched
  LLM/vector code paths and Docker is available).
- `content`: `make test` + `make vet` + `make fmt` (`make test-integration`
  if the change touches DB, Kafka, Redis, or the AI client).
- `user`: `npm test` + `npm run lint` (`npm run test:integration` if the
  change touches Prisma, Redis, or auth flows).
- `frontend`: `npm test` + `npm run lint`.
- `gateway`: no tests; validate config by bringing up `compose.yml`.

Regenerate any affected code (proto stubs, Prisma client, GraphQL types) —
see "Codegen" in AGENTS.md. Generated files are gitignored and must be
regenerated, not edited.

Add tests for new behavior. Bug fixes should include a test that
demonstrates the bug and verifies the fix.

## Opening a pull request

1. Push your branch: `git push origin <branch>`.
2. Open a PR against `dev` using the
   [pull request template](.github/PULL_REQUEST_TEMPLATE.md).
3. Keep the title one line, no prefix, imperative — the same rules as
   commits (for example, "Add recommendation RPCs to the ai proto").
4. Fill in the summary, the commands you ran to verify, and any codegen or
   environment notes.
5. CI runs tests and lint per service on every PR; make sure your branch
   passes before requesting review.

## Reporting issues

Use the issue templates in `.github/ISSUE_TEMPLATE/`. Include a clear
description, what you expected, what happened, and the environment (OS,
Docker/Node/Go/Python versions).