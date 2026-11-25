# Deployment

| Target | Use |
|---|---|
| Docker Compose (`docker-compose.yml`) | Evaluation and development on one machine, synthetic data, demo sign-in |
| Helm chart (`deploy/helm/`) | A Kubernetes cluster, OIDC sign-in, your own Postgres and object store |

Compose is not a production setup: it runs demo sign-in, seeds synthetic data and uses development credentials
unless you replace them.

## Docker Compose for evaluation

See [getting started](getting-started.md#run-the-full-stack-with-docker-compose). In short:

```sh
make env                  # random credentials in .env
docker compose up --build
```

Only the web app is published, on `127.0.0.1:${OPENDISPATCH_WEB_PORT:-3000}`. The engines and the api are reachable
only inside the Compose network. Engine containers run read-only with a `tmpfs` at `/tmp`; every image runs as a
non-root user.

## Helm chart

The chart is `deploy/helm/opendispatch` (chart version 0.1.0; its values interface may still change).
The chart folder also holds one values file per install mode:

| File | Install mode | What it sets |
|---|---|---|
| `values-private.yaml` | `private` | One tenant in the operator's own cluster. Keycloak in the install, routing left to the installer, live feeds on |
| `values-dedicated.yaml` | `dedicated` | One tenant, hosted for the operator. Keycloak in the install, Gateway API routing, board on replay |
| `values-shared.yaml` | `shared` | Many tenants in one install, isolated by row-level security. An external Keycloak realm with one organisation per tenant; one worker per tenant |

Every address in these files is an `example` placeholder. Copy the file for your mode and set your own values.

### What you provide

| Item | Values key | Notes |
|---|---|---|
| Public URL | `global.publicUrl` | https; the chart refuses http unless `auth.allowInsecureHttp` (throwaway tests only) |
| Image registry | `global.imageRegistry`, `images.*` | Prefix for the four images; pin by tag and, ideally, digest |
| Tenant ids | `tenants[].id` | Lower-case UUIDs. Private and dedicated: exactly one. Shared: one per tenant, each with its Keycloak `organization` |
| Record source | `global.recordDataSource` | `SYNTHETIC` for a test install, `LIVE` for a real one |
| Database | `database.existingSecret`, `database.cidrs` | A Secret with keys `owner-url` (used only by the migration job) and `app-url` (api, worker). See [bring your own Postgres](#bring-your-own-postgresql) |
| Object store | `objectStorage.endpoint`, `port`, `bucket`, `useSSL`, `existingSecret` | A Secret with keys `access-key` and `secret-key` |
| Keycloak database | `keycloak.database.jdbcUrl`, `keycloak.database.existingSecret` | When `keycloak.enabled`; a Secret with `username` and `password` |
| Routing | `routing.type` | `gateway` (Gateway API `HTTPRoute`, needs `routing.gateway.parentRefs`), `ingress`, `route` (OpenShift) or `none` |

The chart generates one Secret at install, kept on upgrade and uninstall, with the session signing secret, the OIDC
client secret, the Keycloak bootstrap password, the first Administrator's one-time password and the identity-provider
service account secret. None of them is printed.

### Install

```sh
helm install opendispatch deploy/helm/opendispatch \
  --namespace opendispatch --create-namespace \
  -f deploy/helm/opendispatch/values-private.yaml \
  -f my-values.yaml
```

What happens:

1. **Validation.** The chart fails early on an unknown install mode, a missing database or object-store Secret, demo
   sign-in (`auth.mode` must be `oidc`), the wrong number of tenants for the mode, or an http public URL.
2. **Migrations** run as a `pre-install` and `pre-upgrade` Job with the owner URL. The api then starts with
   `OPENDISPATCH_MIGRATE_ON_START=0` and never sees the owner role.
3. **api, worker, web and the four engines** start. The worker runs one replica per tenant; do not scale it.
4. **First run** (`firstRun.enabled` with `keycloak.enabled`): a `post-install` Job imports the realm and creates the
   first Administrator in Keycloak (`keycloak.firstAdmin`), then the bootstrap Job maps that user's group to the
   Administrator role. The password is in the generated Secret under `first-admin-password` and must be changed at
   first sign-in, with an authenticator added.
5. **NetworkPolicy** (`networkPolicy.enabled`, on by default) lets only the api and worker reach the engines, and only
   `routerPeers` reach the web app and Keycloak. Engines have no authentication of their own, so keep it on.
6. **PodDisruptionBudgets** are written for components with more than one replica.

Probes: the api answers `/livez` and `/ready` on 8081; the worker answers `/livez`, `/readyz` and `/ready` on 8082;
engines answer `/health` on 8080; the web app listens on 3000.

Resource requests and limits for every component are in the values files; `values-private.yaml` has a starting size.
Measure with your own volumes before relying on it.

### Upgrade

```sh
helm upgrade opendispatch deploy/helm/opendispatch -n opendispatch \
  -f deploy/helm/opendispatch/values-private.yaml -f my-values.yaml
```

The migration Job runs again first. Take a backup before every upgrade.

## Offline image bundle

For a cluster without internet access, `scripts/bundle` carries the images on removable media.

On a build host with internet:

```sh
bash scripts/bundle/bundle.sh --out /path/to/bundle --build --tag 0.1.0
bash scripts/bundle/bundle.sh --list-third-party      # the extra images the chart needs (today: Keycloak)
```

- Without `--build` it takes `opendispatch-{api,worker,web,engines}:TAG` from the local Docker.
  `OPENDISPATCH_BUNDLE_IMAGE_<NAME>=ref` takes one image as it is.
- Third-party images are read from the chart's `values.yaml` (`images.*`, each pinned by tag and digest) and pulled by
  digest. The saved image must keep that digest, so Docker must use the containerd image store.
- `--sbom-dir` copies SBOM files into the bundle; `--gzip` compresses each image tarball.
- The bundle holds `images/*.tar`, `manifest.json`, `SHA256SUMS` and a copy of `load.sh`.

On the target:

```sh
bash /path/to/bundle/load.sh --verify-only                         # check every file against SHA256SUMS
bash /path/to/bundle/load.sh --runtime k3s                         # import into k3s containerd (as root)
bash /path/to/bundle/load.sh --runtime docker --registry registry.example/opendispatch
```

`load.sh` imports nothing if any file fails its checksum. On k3s it also adds the `repository@digest` name so a chart
pinned by digest finds the image. Carry `SHA256SUMS` by a second channel if you do not trust the medium: the checksums
prove the files match the list, not who made the list.

## Backups

`scripts/backup/backup.sh` dumps the database and copies the import bucket; `restore.sh` restores both and checks the
result. Object storage is copied with [rclone](https://rclone.org), so any S3-compatible store works. If `pg_dump` or
`rclone` is not installed, set `OPENDISPATCH_PG_IMAGE` (a Postgres image of the server's major version) or
`OPENDISPATCH_RCLONE_IMAGE` to run them from a container.

```sh
export PGPASSWORD=...                       # never put the password in the URL; the scripts refuse it
export OPENDISPATCH_BACKUP_DATABASE_URL=postgres://opendispatch_owner@db.example:5432/opendispatch
export OPENDISPATCH_BACKUP_S3_URL=https://s3.example
export OPENDISPATCH_BACKUP_S3_ACCESS_KEY=... OPENDISPATCH_BACKUP_S3_SECRET_KEY=...
bash scripts/backup/backup.sh --out /backups          # --no-objects skips the bucket
```

A backup folder `opendispatch-backup-<UTC time>/` holds the `pg_dump` custom-format dump and its table of contents,
row counts per table, a check of `forecast_values`, the bucket's objects, `metadata.json` (server, TimescaleDB and
migration versions) and `SHA256SUMS`. The database URL must be the owner role or a superuser, because row-level
security hides rows from every other role.

```sh
export OPENDISPATCH_RESTORE_ADMIN_URL=postgres://postgres@db.example:5432/postgres
bash scripts/backup/restore.sh --from /backups/opendispatch-backup-20261125T020000Z \
  --db opendispatch_restored [--owner opendispatch_owner] [--drop-existing] [--no-objects]
bash scripts/backup/restore.sh --from ... --db ... --verify-only
```

Restore verifies the checksums, refuses to replace an existing database without `--drop-existing`, requires the same
TimescaleDB version on the target, runs `timescaledb_pre_restore` and `timescaledb_post_restore` around
`pg_restore`, then compares row counts, the `forecast_values` check and the hypertables with the backup and reports
any difference. Objects go to `OPENDISPATCH_RESTORE_S3_*`. Practise a restore before you need one.

## Bring your own PostgreSQL

- **PostgreSQL 16 or later.** TimescaleDB is optional but recommended for `forecast_values`. Use the
  Apache-2.0 `-oss` build (the Compose stack uses `timescale/timescaledb:2.30.2-pg16-oss`), not the build under the
  Timescale licence. Without the extension, or with `opendispatch.timescaledb=off`, the migration leaves
  `forecast_values` a plain table.
- **Two roles.** An owner role that owns the schema and has `BYPASSRLS` (used only by the migration job and backups),
  and an application role with `NOSUPERUSER NOBYPASSRLS` and `SELECT, INSERT, UPDATE, DELETE` on the tables. See
  `deploy/compose/postgres-init.sh` for the grants.
- **Connection URLs** go into the Secret named by `database.existingSecret` (`owner-url`, `app-url`). Add the
  database's address range to `database.cidrs` so the NetworkPolicy allows egress to it.
- Turn off TimescaleDB telemetry (`timescaledb.telemetry_level=off`) if your policy requires it; the Compose stack does.

## Any S3-compatible object store

Import files are buffered in a bucket (`opendispatch-imports` by default). The api uses the S3 API only, so SeaweedFS
(in Compose), MinIO, Ceph RGW or a cloud provider's S3 all work. Set `OPENDISPATCH_S3_ENDPOINT`, `_PORT`, `_USE_SSL`,
`_BUCKET`, `_ACCESS_KEY` and `_SECRET_KEY` (chart: `objectStorage.*`). Create the bucket first. The api sweeps
abandoned chunked uploads every hour.

## Keycloak

Installs sign in through OIDC, and Keycloak 26 is the supported provider.

- **In the install** (`keycloak.enabled: true`, private and dedicated): the chart runs Keycloak under
  `global.publicUrl` at `/idp`, with its own database (`keycloak.database.*`), the Arabic and English login theme from
  `deploy/keycloak/themes`, and the first-run Jobs above. Identity providers (SAML or OIDC federation to your
  directory) are added in Admin, Sign-in and Identity Providers, which the api writes to Keycloak through a service
  account.
- **External** (`keycloak.enabled: false`): set `auth.issuer`. In the shared mode the realm has Organizations on, one
  organisation per tenant, and the token carries the organisation claim; `sharedRealm.enabled` runs a Job that sets
  this up idempotently.
- **Roles are not Keycloak roles.** OpenDispatch maps a user's groups to one of its roles through each tenant's group
  rules (Admin, Users and Roles). A user with no matching group signs in and sees a no-access page.

For development, `pnpm keycloak:dev up` starts Keycloak on `127.0.0.1:8180` with the `opendispatch` realm from
`deploy/keycloak/realm-opendispatch-dev.json` and demo users (`admin.demo`, `planner.demo` and so on); generated
passwords and secrets are written to a git-ignored state folder. `pnpm keycloak:dev tenants` writes a tenants file
for the api.
