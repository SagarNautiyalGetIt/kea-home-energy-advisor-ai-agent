# Infrastructure

Everything that runs the system somewhere other than a laptop.

| Path | What goes in it |
|---|---|
| `docker-compose.yml` | Local Postgres. Every team uses this daily |
| [`aws/`](aws/) | Sydney EC2 application + private RDS PostgreSQL deployment |

## Local

```bash
make db        # start postgres, wait for it to be ready
make db-logs   # tail it
make db-stop   # stop it, keep the data volume
```

Ollama is deliberately **not** in the compose file. Docker Desktop on macOS is a Linux VM
with no access to the Apple GPU, so a containerised model server silently drops to CPU
speed. Install it natively: `brew install --cask ollama`.

## AWS demo

The [deployment plan](aws/deployment-plan.md) describes the stack in
`ap-southeast-2` (Sydney). Docker Compose runs the website, API/Piper and
hourly evaluator on EC2; a private RDS PostgreSQL 16 instance holds the
application and serving database. The data pipeline remains local. The Cloud
Owner controls deployment and teardown manually using the
[AWS Makefile](aws/Makefile) and [operator README](aws/README.md).
Future sessions reuse a retained Elastic IP; releasing it is a separate manual
command after session teardown.

Bill-shock alerts are planned to use SES for email, SNS for SMS and Amazon
Connect for phone calls; see [Alert delivery](aws/deployment-plan.md#alert-delivery).
SES and SNS are account-level and still in the sandbox. A session creates the
Connect instance and its NZ number only with `ENABLE_VOICE_ALERTS=1`. Delivery
stays off until the backend gateways exist.

## Secrets — the hard rule

**No credential may be committed or placed in a tracked file.** Not in a
`.tfvars`, a compose file, or a comment, not even temporarily. Deployment-only
secrets go in owner-only files under the ignored `aws/.work/` directory.

- Local AWS access: `aws configure` or SSO. Never a file in the repo.
- CI: GitHub Actions secrets.
- Deployed: the current EC2 workflow exports temporary team SSO credentials
  into a protected runtime file for Sydney Bedrock. Refresh them before expiry.

`.gitignore` blocks `*.tfstate`, `*.tfvars`, `.aws/`, `*.pem` and `*.key` — but the
ignore file is a safety net, not the control. If you are about to type a real secret into
a file, stop.

Terraform state and the SSH key for an active deployment belong in an ignored
`aws/.work/` session directory. The retained Elastic IP has separate state in
`aws/.work/elastic-ip/` that must stay until the IP is explicitly released.
Local database exports are kept separately.

## Related

- [`../SECURITY.md`](../SECURITY.md) — data handling and secrets
- [`../docs/adr/0004-llm-provider-interface.md`](../docs/adr/0004-llm-provider-interface.md)
- [`../docs/adr/0006-postgres-in-sprint-2.md`](../docs/adr/0006-postgres-in-sprint-2.md)
- [`../docs/teams/aws.md`](../docs/teams/aws.md) — team onboarding
