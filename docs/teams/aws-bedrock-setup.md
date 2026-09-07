# Connecting Bedrock — runbook

Getting `KEA_PROVIDER=bedrock` working against a real model, safely. Two branches,
because the credential flow is completely different depending on the account:

- **[Branch A — AWS Academy Learner Lab](#branch-a--aws-academy-learner-lab)** — temporary
  keys, expire every session, no IAM console.
- **[Branch B — standard account with admin](#branch-b--standard-account-with-admin)** —
  the proper setup, short-lived SSO credentials and a least-privilege policy.

Do **[step 0](#step-0--before-anything-that-can-cost-money)** in both cases. Then your
branch. Then **[verify](#step-5--verify)** and **[the security checklist](#security-checklist)**.

Related: [ADR-0010](../adr/0010-aws-deployment.md) (why Sydney, why no NAT),
[ADR-0004](../adr/0004-llm-provider-interface.md) (the provider seam),
[the AWS team page](aws.md).

---

## Rules that hold in every branch

**A credential never enters this repository.** Not in `.env`, not in a `.tfvars`, not in a
comment, not "just while I test it". `.env` is gitignored, but that is a safety net rather
than the control — the control is that credentials live in `~/.aws/credentials`, which is
outside the repo entirely. The app reads them through the standard AWS chain and never
from a `KEA_*` variable.

**Never paste a key into a chat window, an AI assistant, a ticket, or a screenshot.** If a
tool needs credentials, you type them into the tool yourself. Anything pasted into a chat
should be assumed to persist somewhere you cannot delete from.

**If a key is exposed, rotate it before doing anything else.** Not after the demo, not
after you have checked whether anyone used it. Deactivate → delete → issue a new one.
Branch B has the exact steps; on Learner Lab, ending the lab session invalidates them.

---

## Step 0 — before anything that can cost money

Do this first, on both branches. It takes three minutes and it is the difference between
a surprise and a notification.

### 0.1 Set a budget with an alarm

AWS Console → **Billing and Cost Management** → **Budgets** → **Create budget**

| field | value |
|---|---|
| Budget type | Cost budget |
| Period | Monthly |
| Amount | **$5 USD** |
| Alert threshold | 50% *actual*, and a second at 80% *forecasted* |
| Email | yours |

$5 is deliberately low. This work should cost cents — see [what this actually
costs](#what-this-actually-costs) — so an alert at $2.50 means something is wrong, which
is exactly what you want a budget to tell you.

> On Learner Lab you usually cannot create budgets; the lab shows your remaining credit on
> the dashboard instead. Check it before and after your first test run.

### 0.2 Know which region you are in

ADR-0010 specifies **`ap-southeast-2` (Sydney)** — closest to NZ, and data residency is a
pitch point. Use it if you can.

Bedrock model availability varies by region, and Learner Lab often restricts you to
`us-east-1`. If you end up there, that is fine for *testing the model* but note it in the
pitch: the deployed region is a separate decision from the one you developed against, and
claiming NZ data residency while calling Virginia would not survive a question.

---

## Branch A — AWS Academy Learner Lab

Temporary credentials, no IAM console, and Bedrock may not be available at all. Find out
early rather than at 2am before the demo.

### A.1 Start the lab and copy the credentials

1. Open the Learner Lab and click **Start Lab**. Wait for the dot beside "AWS" to go green.
2. Click **AWS Details** → **AWS CLI** → **Show**.
3. You will see a block with **three** values: `aws_access_key_id`,
   `aws_secret_access_key`, and `aws_session_token`. The third one is the giveaway that
   these are temporary.

### A.2 Put them where the SDK looks

Create `~/.aws/credentials` (outside the repo) and paste the block under a named profile:

```bash
mkdir -p ~/.aws && chmod 700 ~/.aws
```

Then open `~/.aws/credentials` in an editor and paste:

```ini
[kea]
aws_access_key_id = <paste>
aws_secret_access_key = <paste>
aws_session_token = <paste>
```

Lock the file down — it is readable by every process running as you otherwise:

```bash
chmod 600 ~/.aws/credentials
```

Set the region and profile for your shell:

```bash
export AWS_PROFILE=kea AWS_REGION=us-east-1
```

> **These expire in about four hours**, and every time you restart the lab you get a new
> set. When calls suddenly fail with `ExpiredToken`, that is all this is — re-copy the
> block. `bedrock_check.py` names this failure explicitly so you do not go hunting.

### A.3 Check whether Bedrock is available to you at all

```bash
aws bedrock list-foundation-models --by-provider anthropic --region us-east-1
```

- **A list of models** → good, continue to [step 4](#step-4--enable-model-access).
- **`AccessDeniedException`** → your lab role cannot use Bedrock. Try `--region us-west-2`.
  If that also fails, Bedrock is blocked on this account and no amount of configuration
  will change it. Go to [when Bedrock is not available](#if-bedrock-is-not-available).

---

## Branch B — standard account with admin

The proper setup. Two decisions worth making correctly, because both are hard to walk back.

### B.1 Do not use the root user

If you are signed in as root (the email address you created the account with):

1. **Enable MFA on it now** — IAM → Security credentials → MFA. An unprotected root account
   with billing attached is the single worst exposure available here.
2. Create an admin user for yourself and use that from now on. Root is for account-level
   things only (closing the account, changing billing) and should be used a handful of
   times ever.

### B.2 Prefer IAM Identity Center over an access key

Long-lived access keys are the thing that leaks. They have no expiry, so a key committed
in March is still valid in September. IAM Identity Center issues credentials that expire
in hours and refresh with a browser login.

**Set it up:**

1. Console → **IAM Identity Center** → Enable.
2. **Users** → Add user (yourself).
3. **Permission sets** → Create → *Custom permission set* → attach the
   [least-privilege policy below](#the-least-privilege-policy).
4. **AWS accounts** → select the account → Assign user → assign the permission set.

**Then locally:**

```bash
aws configure sso --profile kea
```

It asks for the SSO start URL (from the Identity Center dashboard) and the region, opens a
browser, and writes a profile. From then on:

```bash
aws sso login --profile kea
export AWS_PROFILE=kea AWS_REGION=ap-southeast-2
```

That is the whole flow, and there is no long-lived secret on your disk at any point.

### B.3 If you must use an access key instead

Sometimes Identity Center is not available on a course account. An IAM user with an access
key works, with these conditions:

1. IAM → **Users** → Create user. **Do not** give it console access — this identity exists
   only for the SDK.
2. Attach the [least-privilege policy below](#the-least-privilege-policy). Not
   `AmazonBedrockFullAccess`, and certainly not `AdministratorAccess`.
3. **Security credentials** → Create access key → choose *Application running outside AWS*.
4. Copy both values **once** — the secret is never shown again.

```bash
aws configure --profile kea      # paste both, region ap-southeast-2, output json
chmod 600 ~/.aws/credentials
```

Then set a calendar reminder to delete the key when the project ends. An access key that
outlives its project is the one that ends up in a public repo two years later.

### The least-privilege policy

This is the whole permission set the application needs. Invoke and list — nothing that can
create, delete, or spend beyond a model call.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeAnthropicModels",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:ap-southeast-2::foundation-model/anthropic.*",
        "arn:aws:bedrock:*:*:inference-profile/*anthropic.*"
      ]
    },
    {
      "Sid": "DiscoverModels",
      "Effect": "Allow",
      "Action": [
        "bedrock:ListFoundationModels",
        "bedrock:ListInferenceProfiles",
        "bedrock:GetFoundationModel"
      ],
      "Resource": "*"
    }
  ]
}
```

Three things about it worth understanding rather than copying blindly:

- **The `Resource` on the invoke statement is scoped to Anthropic models**, so a leaked
  credential cannot be used to run someone's expensive image model on your account.
- **The inference-profile ARN is separate and necessary.** In several regions the newer
  Claude models are only invocable through a cross-region profile, and that is a different
  resource type from the foundation model. Omitting it produces an `AccessDenied` that
  looks exactly like the model not being enabled.
- **The discovery statement is `Resource: "*"` because it has to be** — listing is an
  account-level operation. It reads metadata only and cannot incur cost.

---

## Step 4 — enable model access

**This catches almost everyone**, and valid credentials will not save you: model access is
opt-in **per account and per region**.

1. Console → **Bedrock** → make sure the region selector is your region.
2. Left nav → **Model access** → **Modify model access**.
3. Tick the **Anthropic** Claude models.
4. Submit. Anthropic models are usually granted instantly; some require a short use-case
   form.

Then find out what the model is actually *called* here, rather than guessing:

```bash
aws bedrock list-foundation-models --by-provider anthropic \
  --query 'modelSummaries[].modelId' --output table

aws bedrock list-inference-profiles \
  --query 'inferenceProfileSummaries[?contains(inferenceProfileId, `anthropic`)].inferenceProfileId' \
  --output table
```

Take an id from that output and put it in `.env`:

```ini
KEA_PROVIDER=bedrock
KEA_BEDROCK_MODEL=<the id you copied>
AWS_REGION=ap-southeast-2
```

> **Do not trust the default in `config.py`.** It is `anthropic.claude-sonnet-5`, which is
> a plausible-looking id that may not exist in your region — model ids carry version and
> date suffixes and change over time. The list above is the source of truth for your
> account. If the id you need has a regional prefix (`apac.`, `us.`, `eu.`), that is an
> inference profile and it is the correct thing to use.

---

## Step 5 — verify

```bash
cd services/api && make setup
```

```bash
cd services/api && .venv/bin/python -m scripts.bedrock_check
```

It runs five checks in the order they fail in practice and stops at the first one with the
specific fix — the credential chain, expiry, region, model access, and finally a real
one-token invocation. That last one matters: valid credentials plus a listed model still
fails if access was never granted for *that* model, and it only shows up on invocation.

It prints no credential material, so its output is safe to paste to a teammate.

Then the thing you actually wanted:

```bash
cd services/api && KEA_PROVIDER=bedrock make api-dev
```

```bash
curl -s localhost:8000/api/health | python3 -m json.tool
```

`provider` should read `bedrock`. If it says `ollama`, the resolver fell back — check the
logs, because [that fallback is deliberately never silent](../../services/api/app/providers/resolver.py).

Finally, run the golden set against the real model. This is the measurement that has been
missing — every number quoted so far comes from the deterministic layers, and the
narration has never been scored:

```bash
cd services/api && KEA_PROVIDER=bedrock .venv/bin/python -m pytest tests/test_golden_set.py -q
```

---

## Security checklist

Work through this once Bedrock is answering. Items marked **★** are the ones that matter
for *this* project specifically rather than being general AWS hygiene.

### Credentials

- [ ] Root user has MFA and is not used day to day (Branch B)
- [ ] `~/.aws/credentials` is `chmod 600`, `~/.aws` is `chmod 700`
- [ ] No credential anywhere under the repo. Run this — it should print nothing:

      ```bash
      git grep -nEI "\b(AKIA|ASIA)[0-9A-Z]{16}\b|aws_secret_access_key[[:space:]]*=[[:space:]]*[A-Za-z0-9/+]{20,}" -- ':!*.svg' ':!*.png' ':!*.jpg' ':!*.json'
      ```

      The word boundaries and the asset exclusions are not decoration: a bare
      `AKIA[0-9A-Z]{16}` matches inside base64-encoded images, and this repo has several
      committed as data URIs. A scan that cries wolf on every run is a scan people stop
      reading, which is worse than not having one.
- [ ] The policy attached is the least-privilege one above, not `*FullAccess`
- [ ] Access keys (if any) have a deletion date in your calendar
- [ ] `.env` is still gitignored — verify: `git check-ignore -v .env`

### Cost

- [ ] Budget at $5 with alerts at 50% actual and 80% forecast
- [ ] No provisioned throughput — on-demand only. Provisioned is a five-figure commitment
- [ ] `DEFAULT_MAX_TOKENS = 300` in `bedrock.py` left alone. It is a cost ceiling as much
      as a style choice, and the narrate-only architecture is what makes it sufficient

### ★ Privacy — the ones that touch your own pitch

- [ ] **Decide deliberately about model invocation logging.** Bedrock → Settings → Model
      invocation logging writes **full prompts and completions** to S3 or CloudWatch. It is
      genuinely useful for debugging the narration. It also means customer usage figures
      leave the request path and land in a bucket with its own retention and access policy.
      Your survey found **47.6% of customers do not trust AI with their usage data** — so
      this is a product decision, not an ops toggle. If you enable it: private bucket,
      encryption on, a lifecycle rule that expires objects, and say so in the write-up.
- [ ] **Know what AWS does with the data, because you will be asked.** Bedrock does not use
      your prompts to train models and does not share them with model providers. Confirm
      the current wording on the AWS Bedrock data-protection page and cite it rather than
      paraphrasing me — a claim about someone else's data handling should have a source.
- [ ] **Region tells the data-residency story.** `ap-southeast-2` keeps inference in
      Sydney. If you tested from `us-east-1` on Learner Lab, do not claim otherwise on a
      slide; say which region the deployment targets and which one the testing used.
- [ ] ★ **The prompt-cache boundary is a privacy boundary.** `bedrock.py` puts the cache
      breakpoint on the system block and nowhere else, so nothing customer-specific is ever
      inside a cached prefix another customer's request could hit. Do not move it when
      tuning cost.
- [ ] ★ **No PII reaches the model.** `FactBundle` carries no name, address or account
      number by design — the one exception is `build_account_identity`, which is scoped to
      the authenticated account. Worth re-checking after any change to `explain.py`.

### Operational

- [ ] CloudTrail is on (it is by default for management events) so you can see what a
      credential did if one leaks
- [ ] CloudWatch log retention set to 7 days, not "never expire" — retention is the cost
      lever, per ADR-0010
- [ ] ★ Consider a **Bedrock Guardrail** if you demo live. It is a content filter in front
      of the model, and the relevant case is not profanity — it is a customer typing
      something distressing into a chat box in front of judges. Note that
      `resolver._REFUSE` and the `HARDSHIP` route already handle the cases you can predict;
      a guardrail covers the ones you cannot.

---

## What this actually costs

Worth knowing so the budget alarm does not scare you, and because the cost argument is
part of the pitch.

One `why_bill_high` turn sends roughly **700 input tokens** (a ~350-token system prompt
plus a fact bundle capped at six figures) and generates at most **300 output tokens**.
Prompt caching applies to the system block, so the repeated half is billed at a fraction
after the first call.

At Sonnet-class on-demand pricing that is a fraction of a US cent per turn. **A thousand
demo turns is comfortably under a dollar.** If the budget alarm fires at $2.50, something
is looping — check for a retry storm in `narrate_verified`, which regenerates on a
verification failure.

This is the number the pitch's cost slide should use, and it is a direct consequence of
the narrate-only architecture: layer 1 does the work in Python, and the model writes three
sentences from a short list.

---

## If Bedrock is not available

If the account cannot reach Bedrock in any region, you are not blocked — you are on the
Sprint 2 path, which still works:

```bash
# install ollama, then
ollama pull gemma3:4b
KEA_PROVIDER=ollama make api-dev
```

That gives you a real model to score the narration against. It is a smaller model, so the
layer-3 pass rate is the number to watch — and it is genuinely useful evidence either way,
because ADR-0005's whole argument is that a small model suffices when Python does the
deciding.

Say plainly in the write-up which model produced the measured numbers. "Gemma 3 4B, local"
is a fine answer. "Claude on Bedrock" when it was actually Gemma is the kind of claim that
loses a judged pitch.

---

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| `ExpiredToken` | Learner Lab session ended | Restart the lab, re-copy all three values |
| `UnrecognizedClientException` | Key copied incompletely | Re-copy; check for a trailing newline |
| `AccessDeniedException` on invoke | Model access not enabled | Bedrock → Model access → enable Anthropic. Per region |
| `AccessDeniedException` on list | Policy missing `ListFoundationModels` | Add the discovery statement |
| `ValidationException … inference profile` | Model needs a cross-region profile | Use the `apac.`/`us.` prefixed id |
| `ResourceNotFoundException` | Wrong model id for this region | Re-run `list-foundation-models` |
| `/health` says `ollama` | Resolver fell back | Check `KEA_PROVIDER`; the fallback logs at WARNING |
| Works locally, fails in CI | CI has no credentials | GitHub Actions secrets, or keep CI on the deterministic tests only |
