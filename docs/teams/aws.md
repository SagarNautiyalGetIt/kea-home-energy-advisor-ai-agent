# AWS team

## You own

`infra/` — local Postgres today, the Sprint 3 deployment and Bedrock cutover next.

## First hour

```bash
make db               # start postgres from infra/docker-compose.yml
make db-logs
make setup && make api-migrate && make api-seed && make api-dev
```

Get the whole stack running locally before changing anything about how it deploys. Then
read [ADR-0004](../adr/0004-llm-provider-interface.md) and
[ADR-0006](../adr/0006-postgres-in-sprint-2.md).

## The thing to internalise

The provider seam already exists. `app/providers/base.py` is the interface,
`ollama.py` is the working implementation, `bedrock.py` is the stub. Switching providers
is a config change — `KEA_PROVIDER=bedrock` — not a rewrite.

That means your Sprint 3 work is **everything around the model**, not the model call:
credentials, region, networking, the database, and how the thing gets deployed at all.
The application side is already done and waiting.

Region is `ap-southeast-2` (Sydney) — closest to NZ, and latency is visible in a live
demo.

## Rules specific to you

**No credential ever enters this repository.** Not in a `.tfvars`, not in a compose file,
not in a comment, not "just while I test it".

| Context | How credentials get there |
|---|---|
| Local | `aws configure` or SSO |
| CI | GitHub Actions secrets |
| Deployed | An instance role or task role — never long-lived keys in env vars |

`.gitignore` blocks `*.tfstate`, `*.tfvars`, `.aws/`, `*.pem`, `*.key`. That is a safety
net, not the control. The control is you not typing it.

**Ollama is deliberately not containerised.** Docker Desktop on macOS is a Linux VM with
no Apple GPU access, so a containerised model server silently drops to CPU speed. Don't
"fix" its absence from the compose file.

**Terraform state is not committed.** Before the first deploy, decide where it lives —
S3 with a DynamoDB lock is the usual answer — and write it up as an ADR. Two people
running `apply` against local state on the same day is a bad afternoon.

## Open decisions for you to make

- Where Terraform state lives (ADR needed)
- RDS vs a container-hosted Postgres for the deployed environment
- How the frontend is served — S3 + CloudFront, or alongside the API

## Related

- [`../../infra/README.md`](../../infra/README.md)
- [`../../SECURITY.md`](../../SECURITY.md)
- [`../adr/`](../adr/) — write yours here
