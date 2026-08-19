# infra/ — AWS team

Everything that runs the system somewhere other than a laptop.

| Path | What goes in it |
|---|---|
| `docker-compose.yml` | Local Postgres. Every team uses this daily |
| `aws/` | Infrastructure as code for the Sprint 3 deployment |

## Local

```bash
make db        # start postgres, wait for it to be ready
make db-logs   # tail it
make db-stop   # stop it, keep the data volume
```

Ollama is deliberately **not** in the compose file. Docker Desktop on macOS is a Linux VM
with no access to the Apple GPU, so a containerised model server silently drops to CPU
speed. Install it natively: `brew install --cask ollama`.

## Sprint 3 — Bedrock

The provider seam already exists ([ADR-0004](../docs/adr/0004-llm-provider-interface.md)):
`app/providers/base.py` defines the interface, `bedrock.py` is the stub. Switching is a
config change, `KEA_PROVIDER=bedrock`, not a rewrite. What this team needs to land is
everything around it — credentials, region, networking, the database.

Region is `ap-southeast-2` (Sydney). It is the closest region to NZ and the one that
matters for latency in a live demo.

## Secrets — the hard rule

**No credential ever enters this repository.** Not in a `.tfvars`, not in a compose file,
not in a comment, not "temporarily".

- Local AWS access: `aws configure` or SSO. Never a file in the repo.
- CI: GitHub Actions secrets.
- Deployed: an instance role or task role. Not environment variables holding long-lived keys.

`.gitignore` blocks `*.tfstate`, `*.tfvars`, `.aws/`, `*.pem` and `*.key` — but the
ignore file is a safety net, not the control. If you are about to type a real secret into
a file, stop.

Terraform state is not committed. Before the first deploy this team needs to decide where
it lives (S3 + DynamoDB lock is the usual answer) and write that up as an ADR.

## Related

- [`../SECURITY.md`](../SECURITY.md) — data handling and secrets
- [`../docs/adr/0004-llm-provider-interface.md`](../docs/adr/0004-llm-provider-interface.md)
- [`../docs/adr/0006-postgres-in-sprint-2.md`](../docs/adr/0006-postgres-in-sprint-2.md)
- [`../docs/teams/aws.md`](../docs/teams/aws.md) — team onboarding
