# ADR-0012 — One EC2 application host and a private RDS database

**Date:** 2026-10-02 · **Status:** Accepted · **Owner:** Harvey ·
**Supersedes:** [ADR-0010](0010-aws-deployment.md)

## Context

ADR-0010 planned Lambda behind API Gateway, a CloudFront site and RDS. Three things
changed what could be built on the university account:

1. **Voice needs a long-lived process.** The voice channel uses WebSockets and runs the
   Piper speech binary inside the API. ADR-0010 already named this as unresolved: Lambda
   cannot hold the socket, so voice could not deploy that way.
2. **The account cannot create IAM roles.** There is no Lambda execution role, no EC2
   instance profile and no Enhanced Monitoring role. Anything that calls Bedrock must use
   the team's temporary SSO credentials.
3. **The deployment exists for demos.** It is created before a demo and torn down after
   it, inside an NZD 200 team allowance. Nothing needs to scale or survive a failure.

## Decision

```
  browser / phone / Android app
            │ HTTPS + WSS (trusted certificate for the Elastic IP)
            ▼
  EC2 t3.small, Docker Compose
  ├── Caddy + static website
  ├── FastAPI + Piper ──► Bedrock Nova Lite (ap-southeast-2)
  └── hourly evaluator (systemd timer)
            │ PostgreSQL, verify-full TLS
            ▼
  RDS PostgreSQL 16, db.t4g.micro, private subnets
```

| concern | choice | why |
|---|---|---|
| compute | **One EC2 host running the existing containers** | The same Compose shape as the laptop. Voice, Piper and the evaluator run unchanged. |
| database | **Private RDS PostgreSQL 16, single-AZ** | A managed database kept apart from the API host, reachable only from its security group. It adds cost; it does not save any. |
| data | **Restore the local serving export** | The data pipeline stays local. Each deployment restores a frozen export and checks every table count and sequence against its manifest. |
| address | **Retained Elastic IP in its own Terraform state** | The installed Android app keeps one URL across sessions. Session teardown cannot release it. |
| HTTPS | **Short-lived Let's Encrypt certificate for the IP** | No domain is needed. It lasts about six days, longer than a demo. |
| model access | **Temporary SSO credentials in a root-only runtime file** | The only option without IAM roles. They expire within hours and are refreshed by hand. |
| lifecycle | **Manual `make aws-deploy` and `make aws-teardown`** | The Cloud Owner decides when it runs. Teardown audits Sydney before removing local state. |
| alerts | **SES for email, SNS for SMS, Amazon Connect for calls** | All three reached a real NZ recipient from this account on 2 October 2026. End User Messaging had no AU or NZ voice numbers, and Connect's own email and SMS add nothing over SES and SNS. Connect is created per session only with `ENABLE_VOICE_ALERTS=1`. |

The operator steps are in the [AWS README](../../infra/aws/README.md) and the
[deployment plan](../../infra/aws/deployment-plan.md).

## Consequences

**Good.** Voice works in the cloud. The deployed stack is the local stack, so a demo
problem reproduces on a laptop. A deployment takes about 20 minutes and has been
restored, verified and torn down end to end.

**Bad.** Bedrock stops working when the SSO credentials expire, unless someone runs
`refresh-credentials`. The site is public, demo logins are on and there is no rate limit,
so anyone who finds the address can spend the Bedrock budget while it runs. The
operator's SSO credentials sit on an internet-facing host. All three are accepted only
because the deployment lives for the length of a demo.

**Watch for.** Tear down after each demo: EC2, RDS and their storage charge by the hour.
The retained Elastic IP is charged even with nothing attached; release it with
`ip-release` when no further demos are planned. SES and SNS stay in the
sandbox, so alerts reach verified recipients only until AWS support cases raise
SES production access and the USD 1 SMS cap. If the account later allows IAM roles,
replace the SSO credentials with an instance profile limited to Bedrock invoke before
leaving the stack up for longer.

Related: [ADR-0004](0004-llm-provider-interface.md) (the provider seam Bedrock uses),
[ADR-0006](0006-postgres-in-sprint-2.md) (why PostgreSQL, and the path to RDS).
