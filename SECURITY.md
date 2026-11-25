# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Email **omni2@theomni-labs.com** with:

- what you found and where (component, file, endpoint),
- how to reproduce it, and the impact you expect,
- the version or commit you tested.

We acknowledge a report within three working days and keep you informed while we fix it. We agree a
disclosure date with you, and credit you in the release notes unless you prefer otherwise.

## Supported versions

Security fixes go into the latest minor release. Before 1.0, only the most recent release is supported.

| Version | Supported |
| --- | --- |
| 0.1.x | yes |

## Scope

In scope: the web app, the api and worker, the engines, the Helm chart and the compose files in this
repository. Particularly interesting: anything that lets one tenant read or change another tenant's data
(the row-level security boundary), privilege escalation between roles, authentication bypass, and secrets
leaking into logs or responses.

Out of scope: the demo role switcher being usable when `OPENDISPATCH_AUTH_MODE=demo` (that is its purpose; it
is for local evaluation only), the development default credentials in `docker-compose.yml`, and findings in
third-party services such as Keycloak, PostgreSQL or SeaweedFS, which should go to those projects.
