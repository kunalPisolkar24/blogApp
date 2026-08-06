# User Service Load Tests (k6)

Self-contained load test rig for the user service. Everything runs in
Docker on a private network — no host installs, no port collisions.

## Stack

| Container | Image | Purpose |
|---|---|---|
| `user-postgres` | `postgres:16-alpine` | Single primary |
| `user-redis` | `redis:7-alpine` | Cache, no persistence |
| `user-migrator` | service `migrator` stage | One-shot `prisma migrate deploy` |
| `user-service` | service `runtime` stage | System under test |
| `k6` | `grafana/k6:latest` | Load driver |

Users are seeded through the API in k6's `setup()` phase, so no extra
seed container or image stage is needed.

## Quick start

```bash
# smoke test (10s, 10 RPS)
make load-test RPS=10 VUS=5 DURATION=10s

# default (mixed scenario, 50 RPS, 20 VUs, 30s)
make load-test
```

k6 prints its end-of-run summary and the exit code propagates, so
threshold failures fail the make target.

## Scenarios

| `SCRIPT=` | Operations | Auth | Notes |
|---|---|---|---|
| `signup` | `signup` | none | Fresh creds per iteration |
| `signin` | `signin` | none | Round-robin over seeded users |
| `me` | `me` | bearer | Tokens from seeded signups |
| `users` | `users(limit)` + `user(id)` | none | 70/30 read mix |
| `update-profile` | `updateProfile` | bearer | Seeded users |
| `mixed` (default) | weighted mix of all | mixed | `WEIGHTS` tunable |

## Tunables

| Var | Default | Meaning |
|---|---|---|
| `RPS` | `50` | Target requests per second |
| `VUS` | `20` | Pre-allocated VUs (k6 may scale to 2x) |
| `DURATION` | `30s` | Test duration |
| `SCRIPT` | `mixed` | Scenario from the table above |
| `WEIGHTS` | `users:30,user:15,me:20,signin:20,updateProfile:10,signup:5` | `mixed` only |
| `SEED_USERS` | `100` | Users created in `setup()` |
| `USER_JWT_SECRET` | `loadtest-jwt-secret-0123456789abcdef` | Shared between seed and service |
| `PG_MEM` `REDIS_MEM` `SVC_MEM` `K6_MEM` | `512M` `256M` `512M` `384M` | Container memory caps |

## Examples

```bash
make load-test-signup RPS=50 DURATION=1m
make load-test SCRIPT=signin RPS=100 VUS=50 DURATION=2m
make load-test-cold SCRIPT=mixed    # flush redis cache before running
make load-test-stop                 # tear everything down
```
