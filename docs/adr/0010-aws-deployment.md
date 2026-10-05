# ADR-0010 — Cost-optimised AWS deployment

**Status:** Superseded by [ADR-0012](0012-ec2-rds-deployment.md) · **Date:** 4 September 2026 · **Sprint:** 3

> The Lambda / API Gateway / CloudFront design below is not what runs. The deployment is
> one EC2 application host and a private RDS database; ADR-0012 records why.

## Context

Sprint 2 ran entirely on a laptop. Sprint 3 deploys, on a **university AWS account** with
two constraints that shape every choice below:

1. **No SES, SNS or Connect.** The services that would otherwise be the obvious answer for
   email, SMS and voice are not available to us. Hence the third-party gateways in
   `app/alerts/channels.py`.
2. **Basic services only, cost-optimised.** A course account, not a startup's. The target
   is *"runs on the free tier, and the bill is legible when it is not"*.

One backend serves both the React app and the mobile app that does not exist yet. Nothing
below is web-specific — it is one HTTP API and one contract.

## Decision

```
  browser ──► CloudFront ──► S3            (React build, static)
                  │
  mobile  ────────┴────────► API Gateway ──► Lambda ──► RDS Postgres
                             (HTTP API)      (FastAPI    (t4g.micro,
                                              + Mangum)   single-AZ)
                                                │
                             EventBridge ───────┤
                             (hourly)           │
                                                ├──► Bedrock  (ap-southeast-2)
                                                └──► Resend / Twilio / Textbelt
```

| concern | choice | why this and not the obvious alternative |
|---|---|---|
| compute | **Lambda + API Gateway HTTP API** | Scales to zero. The API is idle almost all the time and spiky during a demo, which is the exact shape Lambda is cheap for. Free tier: 1M requests + 400k GB-s/month. Fargate would cost ~$15/month to sit idle. |
| gateway | **HTTP API, not REST API** | ~70% cheaper per request and everything we use it for is proxying. REST API's extra features (request validation, API keys) duplicate what FastAPI already does. |
| database | **RDS PostgreSQL `db.t4g.micro`, single-AZ, 20 GB gp3** | Free-tier eligible for 12 months. Aurora Serverless v2 floors at 0.5 ACU ≈ **$43/month** even when idle — the single most expensive mistake available here. Graviton (`t4g`) over `t3` for ~20% less at identical performance. |
| static site | **S3 + CloudFront** | Free tier covers 1 TB egress. |
| scheduling | **EventBridge Scheduler → Lambda** | See "the GET side-effect" below. |
| secrets | **SSM Parameter Store (Standard)** | **Free.** Secrets Manager is $0.40 per secret per month — with eight secrets that is $3.84/month for a feature we do not need (rotation). |
| model | **Bedrock on-demand, `ap-southeast-2`** | Sydney for NZ data residency, which is a pitch point. No provisioned throughput — that is a five-figure commitment. |
| logs | **CloudWatch, 7-day retention** | Retention is the cost lever, not volume. The default is *never expire*, which is how a $0 project quietly becomes a $20/month one. |

### The three traps this avoids, named

**No NAT Gateway.** `$0.045/hour` ≈ **$32/month** before a byte moves, and it is the
single most common way a free-tier AWS project stops being free. Lambda runs *outside* the
VPC; RDS is publicly addressable with a security group allowing only the Lambda's egress
and TLS enforced. That is a deliberate trade — a VPC-attached Lambda with VPC endpoints is
the textbook answer and costs either a NAT or four interface endpoints at ~$7/month each.
For a course project with synthetic data, the security group is sufficient and the
reasoning is written down rather than assumed.

**No Aurora.** See the table. "Serverless" reads as "scales to zero" and does not.

**No provisioned concurrency.** Cold starts on a FastAPI Lambda are ~1.5 s. Real, and
worth it: provisioned concurrency is billed by the hour whether or not anyone calls. The
mitigation is that the *demo* warms it, and `/health` is called on page load anyway.

### The GET side-effect, fixed on the way

`GET /bill-shock` used to dispatch alerts as a side effect of the dashboard polling it.
That is an HTTP anti-pattern and it makes alerting depend on somebody having the page
open. The scheduled Lambda (`EventBridge`, hourly) now evaluates every household and
dispatches; the GET still returns the assessment, and the dispatcher's idempotency
constraint means the two paths cannot double-send. The hourly job is also what releases
alerts deferred by a customer's quiet hours.

### Estimated monthly cost

| | in free tier | after it lapses |
|---|---|---|
| Lambda + API Gateway | $0 | ~$1 |
| RDS t4g.micro + 20 GB | $0 | ~$13 |
| S3 + CloudFront | $0 | ~$1 |
| Parameter Store, EventBridge, SQS | $0 | $0 |
| Bedrock (Sonnet, ~1.5k tokens/answer) | usage | ~$3 per 1,000 answers |
| **total** | **~$0 + model usage** | **~$15/month + usage** |

The narrate-only architecture is what keeps the model line small: layer 1 has already done
the work, so layer 2 writes three sentences from a list of numbers. That is a design
decision showing up as a cost line, and it is worth saying so in the pitch.

## Consequences

**Good.** Runs at ~$0 on the free tier. Every component is a basic, well-understood
service. Scales to zero between demos. The same API serves web and mobile with no
branching.

**Bad.** Cold starts. WebSockets do not work on Lambda, so the **voice channel cannot
deploy this way** — it needs API Gateway WebSocket APIs plus a container, or it stays a
local-only demo feature. That is a real limitation and it is unresolved; voice is
demonstrated locally today.

**Watch for.** The free tier expires 12 months after account creation, and a course
account may already be part-way through. RDS `t4g.micro` is one instance with no failover
— acceptable for synthetic data, not for a real retailer.

Related: [ADR-0004](0004-llm-provider-interface.md) (the seam Bedrock slots into),
[ADR-0006](0006-postgres-in-sprint-2.md) (why Postgres), `infra/aws/` (the Terraform).
