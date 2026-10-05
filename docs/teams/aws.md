# AWS team

## You own

`infra/` — local PostgreSQL and the Sydney AWS demo.

## First hour

```bash
make db               # start postgres from infra/docker-compose.yml
make db-logs
make setup && make api-migrate && make api-seed && make api-dev
```

Get the whole stack running locally before changing anything about how it deploys. Then
read [ADR-0004](../adr/0004-llm-provider-interface.md) and
[ADR-0006](../adr/0006-postgres-in-sprint-2.md).

## Current deployment

Read the [AWS deployment plan](../../infra/aws/deployment-plan.md) and
[operator README](../../infra/aws/README.md); [ADR-0012](../adr/0012-ec2-rds-deployment.md)
records why it is built this way. One EC2 host runs Caddy, the web app, API/Piper and an
hourly evaluator. A private RDS PostgreSQL 16 database holds the application and serving
data. Every session attaches the retained Sydney Elastic IP from a separate Terraform
state; session teardown leaves that address allocated until the Cloud Owner runs the
explicit `ip-release` command.

Only data exported from the local PostgreSQL serving database is restored into RDS; the
data pipeline is not deployed. RDS is never public: `make aws-db-tunnel` exposes it at
`127.0.0.1:15432` through EC2 while the command runs. Region is `ap-southeast-2`
(Sydney). The Cloud Owner explicitly controls each deployment and teardown, and tears
the stack down after each demo.

## Rules specific to you

**No credential ever enters this repository.** Not in a `.tfvars`, not in a compose file,
not in a comment, not "just while I test it".

| Context | How credentials get there |
|---|---|
| Local | University SSO profile `kea-energy` |
| Deployed | Protected runtime file with temporary team SSO credentials for Bedrock |

`.gitignore` blocks `*.tfstate`, `*.tfvars`, `.aws/`, `*.pem`, `*.key`. That is a safety
net, not the control. The control is you not typing it.

**Ollama is deliberately not containerised.** Docker Desktop on macOS is a Linux VM with
no Apple GPU access, so a containerised model server silently drops to CPU speed. Don't
"fix" its absence from the compose file.

**Terraform state is not committed.** The Cloud Owner keeps active session
state, SSH keys and database passwords in the ignored `infra/aws/.work/` directory,
then removes them after a verified teardown. The separate `infra/aws/.work/elastic-ip/`
state must remain until the retained IP is explicitly released. Local database
exports are kept separately.

## Related

- [`../../infra/README.md`](../../infra/README.md)
- [`../../SECURITY.md`](../../SECURITY.md)
- [`../adr/`](../adr/) — write yours here
