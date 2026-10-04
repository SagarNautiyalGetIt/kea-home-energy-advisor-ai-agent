# Team AWS runtime

This module packages the replacement mobile release for the team account. It has not
been applied to AWS. Services being enabled does not establish SES identity verification,
SES/SNS production access, destination eligibility, Connect permissions or Gemini model access.

The API runs in a pinned Docker image on EC2 behind an HTTPS ALB. This supports voice
WebSockets without the legacy Lambda HTTP integration's request-duration limit. The mobile
Talk page uses explicit recorded turns on both platforms; it is not a full-duplex phone call.
Connect handles consent-gated outbound notification calls. Gemini 3.8 Flash TTS generates
the private, generic first prompt; Connect's short recovery/confirmation prompts use Polly.
Neither TTS nor a transport server alone supplies reasoning or transcribing.

## Prerequisites

- Team AWS CLI profile and chosen region; existing VPC and two public subnets in different
  availability zones; an ACM certificate and DNS hostname for the API.
- Existing PostgreSQL with the application's migrations through `0010` applied. Grant the
  runtime SELECT on `kea` marts and read/write on `app`; keep loader permissions separate.
- ECR repository, reviewed Docker image digest, existing Connect instance, claimed source
  number, customer-care queue with operating hours/queue flow, and outbound destination allowlist.
- Verified SES identity and production access; SNS SMS production access/spend limits.
  Enable SMS delivery logging (100% successes and failures), then supply its CloudWatch group.
- Cognito callback/logout URLs for the actual development build and hosted web build. Expo Go
  is not a production authentication test. Each user needs an administrator-assigned immutable
  `custom:account_ref`; the client cannot choose or write this scope.

The module creates Cognito, SES configuration/receipts, a private S3 prompt bucket,
the Connect contact flow, receipt Lambda, failure queue and SMS log subscription.
It assumes the team has already enabled Connect and its care queue. It never creates live
customer phone numbers or inserts customer records.

## Configure and deploy

1. From the repository root, build using `docker build -f services/api/Dockerfile .`. Push to the
   team's ECR repository and record the resulting immutable digest. Docker was unavailable
   on the development machine, so the image build remains a team validation step.
2. Copy this module outside the Vault. Create a private `.tfvars` file with **all required
   variables from `variables.tf`**. Use real values; do not copy example account numbers.
   Set `AWS_PROFILE` and `AWS_REGION` to the team identifiers. Run `terraform init`,
   `terraform validate`, and `terraform plan`. Review the exact resource/cost changes before
   `terraform apply`. Configure DNS to the `api_load_balancer` output.
3. Populate the isolated SSM prefix using AWS CLI's interactive/file input from a protected
   environment file. Store keys, database URL and integration secret as SecureString; do not
   put them in Terraform variables/state, Git, shell history or the mobile bundle.
4. Set these SSM parameters (names below the deployment prefix):

   | Parameter | Value |
   |---|---|
   | `KEA_PRODUCTION`, `KEA_PERSIST` | `1`, `1` |
   | `KEA_DEMO_LOGINS` | `0` |
   | `KEA_DATABASE_URL` | Team PostgreSQL URL |
   | `KEA_CORS_ORIGINS` | Exact HTTPS web origins, comma separated |
   | `KEA_OIDC_ISSUER`, `KEA_OIDC_CLIENT_ID` | Cognito outputs |
   | `KEA_OUTAGE_INGESTION_SECRET` | Distinct random secret, at least 32 characters; distributor integration only |
   | `KEA_REWARD_RECEIPT_SECRET` | Distinct random secret, at least 32 characters; verified-action integration only |
   | `KEA_DELIVERY_RECEIPT_SECRET` | Distinct random secret, at least 32 characters; receipt worker only |
   | `KEA_PROVIDER`, `GEMINI_API_KEY` | `gcp`, team secret |
   | `KEA_VOICE_ENABLED`, `KEA_STT_ENGINE`, `KEA_TTS_ENGINE` | `1`, `gemini`, `gemini` |
   | `KEA_TTS_MODEL`, `KEA_TTS_VOICE` | `gemini-3.8-flash-tts`, `Kore` (choose after audition) |
   | `KEA_ALERTS_ENABLED` | Start `0`; switch to `1` only after the gates below |
   | `KEA_EMAIL_BACKEND`, `KEA_SMS_BACKEND`, `KEA_VOICE_BACKEND` | `ses`, `sns`, `connect` |
   | `KEA_EMAIL_FROM`, `KEA_SES_CONFIGURATION_SET` | Verified sender, module output |
   | `KEA_CONNECT_INSTANCE_ID`, `KEA_CONNECT_FLOW_ID` | Existing instance ID, module output |
   | `KEA_CONNECT_SOURCE_NUMBER`, `KEA_CONNECT_PROMPT_BUCKET` | Claimed E.164 number, module output |
   | `KEA_OUTAGE_SOURCE_HOSTS` | Hosts approved for the distributor ingestion integration |

   Parameters are loaded before importing application settings. An incomplete production
   authentication configuration refuses startup. The EC2 instance uses its role, with no
   embedded AWS keys. The receipt worker reads only its delivery-secret parameter.

5. Build mobile with `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_OIDC_ISSUER` and
   `EXPO_PUBLIC_OIDC_CLIENT_ID`. Sign-in uses PKCE; issuer/audience/signature/expiry and
   household claims are verified by the API. Refresh uses the issuer's token endpoint.
6. With the same environment loaded, run `python -m app.release_readiness --aws` in the
   container. It performs read-only checks; success does **not** prove delivery or speech.
   Restart the API after configuration changes; the hourly sweep gets fresh SSM parameters
   on each invocation. Keep `KEA_ALERTS_ENABLED=0` until the controlled verification passes.

## Deterministic call and receipt workflows

The published contact flow reads the private `kea_notice_audio` S3 attribute. It contains
no balances, account identifiers or payment instructions. Digit 1 transfers to the configured
human-care queue (including hardship support); digit 9 invokes the receipt worker to disable
voice alerts on the server. A failed save tells the caller to use settings/customer care and
never claims success. No input, invalid input and hangup terminate. Prompt/queue failure gives
an app follow-up. No generated text can choose a phone number, alter preferences or route a call.

SES delivery/bounce/complaint events and SNS SMS delivery logs enter an AWS-authorized Lambda.
It signs short-lived receipts for `/api/internal/alerts/delivery`. Bounce, complaint and opt-out
disable the affected channel; later deliveries cannot undo that state. Call answer is not
proof that the message was heard. Duplicate receipts are safe. Async Lambda failures land in
the encrypted 14-day failure queue: alarm on queue depth and replay after correcting the
cause. A receipt arriving before its send is recorded fails and is retried by AWS.

SES/SNS do not provide send idempotency. The unique alert/delivery ledger and an atomic
`scheduled -> sending` claim prevent duplicate workers. A crash after acceptance leaves an
unknown `sending` row for operator investigation; it must not be blindly retried. Connect
adds a deterministic client token. Hourly release rechecks current opt-outs, quiet hours,
forecasts and persisted hardship. Care must explicitly clear a resolved disclosure before
automated bill warnings resume; there is no model-controlled clearing mechanism.

## Data integration and release gates

Outages need a contracted distributor feed or team-maintained source adapter mapping the
installation address/ICP to the correct household. Submit full signed snapshots, including
cancellations and increasing revisions. There is no invented public Vector API or scraper.
Without a linked fresh source the app says unavailable/stale, never "no outages".

Power Clash verified XP needs trusted, signed device/interval receipts with actual tariff
rates, local date and comfort confirmation. Client planning gets separately labelled planning
XP. Never submit self-reported actions as device verified. Examples of receipt models are in
the generated OpenAPI contract; HMAC is SHA256 of `timestamp + '.' + exact body` with five-minute
freshness. The three integration secrets are trusted service credentials, never client keys.
Grant each integration access only to its own SSM secret; startup rejects reused values.

Before enabling outbound sends, test only team-owned opted-in email/phone destinations:
threshold below/above each confidence floor; master and per-channel opt-out; quiet-hours
release; storage failure; hardship suppression; SES bounce/complaint; SNS delivery and opt-out;
Connect 1/9/no input/invalid/prompt failure/queue full; worker retry/failure queue. Verify the
Gemini model and chosen voice with an approved paid speech probe. Test microphone, stop,
backgrounding, playback and refresh on iOS and Android; verify GLB frame time/memory on low-end
devices. Run `qa/mobile-app-repair.md` on a second teammate's machine and obtain independent PR
approval. Keep alerts off until these evidence gates pass.

This EC2 module has one API instance and no rolling deployment controller. Add redundant
instances, autoscaling, rate limiting, log shipping and an operations alarm policy before a
customer production rollout. These are explicit operational limits, not proven production capacity.
