# Kea Energy AWS deployment

The [deployment plan](deployment-plan.md) describes the Sydney architecture.
The [Makefile](Makefile) is the executable deploy, maintenance and teardown
workflow. It retains one Sydney Elastic IP between sessions and creates one
disposable EC2 host running Caddy, the website, API/Piper and an hourly
evaluator, alongside private RDS PostgreSQL 16. The data pipeline stays local;
only the local serving database export is restored into RDS.

## Prerequisites

- Use the `kea-energy` AWS SSO profile for team account `022499038388` and
  region `ap-southeast-2` (Sydney). Do not alter university-managed
  AWSAccelerator, ControlTower or CloudHealth resources.
- Install AWS CLI v2, Terraform 1.11+, Docker Desktop with Buildx, Python 3,
  SSH/SCP and OpenSSL. Building the Android APK also needs Node.js, Android SDK
  and Gradle; installing it on a phone additionally needs ADB. Set `ANDROID_HOME`
  to the SDK directory; the Make target
  detects Homebrew's `/opt/homebrew/share/android-commandlinetools` path.
- Have the local PostgreSQL 16 serving database from
  [`../docker-compose.yml`](../docker-compose.yml) ready. Pause pipeline
  publishing and application writes before exporting; the source database
  on port 5433 is not the serving database.
- Check the team's NZD 200 budget. EC2, its root EBS disk and RDS incur charges until
  session teardown. The retained Elastic IP incurs a public IPv4 charge even
  while no instance is running (currently USD 0.005/hour). Release it only with
  the separate command below. There is no automatic termination.
- RDS uses ordinary PostgreSQL password authentication. The account must allow
  RDS provisioning and use of `AWSServiceRoleForRDS`; the actual Sydney creation
  and restore succeeded on 2 October 2026 without creating a custom project
  IAM role. Enhanced Monitoring and IAM database authentication are disabled.

Verify the identity and Terraform configuration from the repository root:

```bash
aws sso login --profile kea-energy
aws sts get-caller-identity --profile kea-energy --region ap-southeast-2
make -C infra/aws validate
```

Stop if the account is not `022499038388` or the region is not Sydney.

## Deploy

After writes are paused, run:

```bash
make aws-deploy SOURCE_PAUSED=1
```

The deployment saves its session ID in the ignored
`infra/aws/.work/session.env` file. Run `make -C infra/aws session-id` to print
it, or `source infra/aws/.work/session.env` to export `SESSION_ID` into your
current shell. Make cannot change its parent shell's environment. The command
allocates a Sydney Elastic IP if one
is not already retained, exports the full local serving database, then plans
and provisions the session resources, including EC2, private RDS, two database
subnets and the IP association. It issues
a trusted certificate for that IP, builds and transfers the images, exports
temporary SSO credentials for Sydney Bedrock, restores RDS over verified TLS,
checks every exported table count and sequence state, verifies
HTTPS and row counts, then builds the Android APK. Installing the APK is an
optional, separate command. Resume local writes after the export has completed.

Terraform state, SSH keys, credentials and dumps stay in the ignored
`infra/aws/.work/` directory. Never commit them. The retained address has its
own state in `infra/aws/.work/elastic-ip/`; keep that directory until you
explicitly release the address. Losing the state does not stop its AWS charge.
The RDS master password uses Terraform's write-only `password_wo` argument
with an ephemeral input: it is absent from state and saved plans. Separate
application and administrator passwords stay in mode-0600 session files.
The administrator client file is removed from EC2 once the import finishes.
The API uses the `kea` PostgreSQL login, not the RDS administrator account.
The certificate lasts roughly six days and the temporary SSO credentials
expire at the time printed by `runtime`. Read that time: the `login` step can
reuse credentials the CLI already cached, so it may be well under the SSO
session's full length. Plan a credential refresh before a demo that runs past
it. A fresh EC2 host needs a certificate
for the retained IP; an already-installed Android app can keep using that URL.
The first switch from an old auto-assigned IP needs one new Android build.

If deployment stops after creating its session, keep that session ID and state.
Do not rerun `aws-deploy` with the same ID; continue from the failed step with
`make -C infra/aws <step> SESSION_ID=<session-id>`, or run the teardown below
if you want to discard the partial deployment. Use `make -C infra/aws help`
for the step names. When you want to install the built APK, connect and unlock
the phone, authorize USB debugging, then run:

```bash
make -C infra/aws install-apk SESSION_ID="$(make -s -C infra/aws session-id)"
```

If `adb devices` lists nothing, the phone is not exposing USB debugging: check
Developer options and the USB mode, and try a direct cable instead of a hub.
Xiaomi phones also need **Install via USB** enabled in Developer options.

For a local export without deployment, use
`make -C infra/aws export-local SOURCE_PAUSED=1`.
For a specific connected Android architecture, set `ANDROID_ABIS=arm64-v8a`
when invoking the `mobile` step; the default APK includes all architectures.

## Backend database access

RDS stays private. The cloud owner can expose it only on the local loopback
interface through the application EC2 host:

```bash
make aws-db-tunnel SESSION_ID=<session-id>
```

Leave that command running and connect the database client to
`127.0.0.1:15432`, database `kea`. Press Ctrl-C when finished. Set a different
unused local port with `DB_LOCAL_PORT=<port>`. The tunnel command does not
contain or print a database password.

The cloud owner's passwords are in the session directory
`infra/aws/.work/public-<session-id>/`: `db-app-password` for the `kea`
application login and `db-master-password` for the `kea_admin` administrator.
Copy one without displaying it, for example
`pbcopy < infra/aws/.work/public-<session-id>/db-app-password`. RDS requires
TLS. A GUI client connecting to `127.0.0.1` cannot match the RDS hostname, so
set its SSL mode to `require`; the `verify-full` form is described below.
Teardown deletes the session directory and these files with it.

A teammate should use a separate PostgreSQL account and their own SSH key. The
cloud owner must first add that SSH public key to EC2 and allow the teammate's
current public IPv4 `/32` on EC2 port 22. Do not share the deployment owner's
private key. After that one-time setup, the teammate can run:

```bash
make aws-db-tunnel \
  SSH_HOST=<ec2-public-ip> \
  SSH_KEY=<path-to-their-private-key> \
  DB_HOST=<rds-endpoint>
```

Their application can use `127.0.0.1:15432` while the tunnel runs. For clients
that verify the RDS hostname, configure the real RDS endpoint as `host`,
`127.0.0.1` as `hostaddr`, and use the AWS RDS CA bundle with
`sslmode=verify-full`. Never open RDS port 5432 to `0.0.0.0/0`.

## Alert channels

Alerts use SES for email, SNS for SMS and Amazon Connect for phone calls; see
the [deployment plan](deployment-plan.md#alert-delivery). Delivery stays off
until the backend gateways exist. To create the Connect instance, an NZ caller
number and the call flow with a new session, deploy with:

```bash
make aws-deploy SOURCE_PAUSED=1 ENABLE_VOICE_ALERTS=1
```

`apply-create` then prints the Connect instance ID, flow ID and caller number
for the backend configuration. The number is billed while the session runs,
and teardown removes it with the instance. The setting is fixed when the
session is created.

SES and SNS need no per-session resources, but both are in the sandbox: they
deliver only to recipients verified in Sydney. Verify a new email recipient
(they must click the emailed link) and a new SMS recipient (they read back a
texted code) with:

```bash
aws sesv2 create-email-identity --email-identity <address> --profile kea-energy --region ap-southeast-2
aws sns create-sms-sandbox-phone-number --phone-number <+64...> --profile kea-energy --region ap-southeast-2
aws sns verify-sms-sandbox-phone-number --phone-number <+64...> --one-time-password <code> --profile kea-energy --region ap-southeast-2
```

## Maintenance and teardown

Refresh the temporary Bedrock credentials before their printed expiry by
running `make -C infra/aws login` followed by
`make -C infra/aws refresh-credentials SESSION_ID=<session-id>`. Renew the
certificate for an unchanged IP with
`make -C infra/aws renew-cert SESSION_ID=<session-id>` before it expires.
Neither refresh runs automatically.

When you decide to remove the deployment, the command uses the saved session ID:

```bash
make aws-teardown
```

This command verifies the account, applies a session-specific destroy plan,
audits Sydney instances, RDS, its automated backups and DB subnet group, any
Connect instance, VPCs, security groups, key pairs, the recorded EBS volume and
the IP association, then removes the local session directory. It keeps the Elastic IP and local
database export. If teardown fails, keep the state and inspect the failed
step. No deployment is torn down unless this command is invoked.
For RDS sessions, teardown deletes the database and its automated backups
without a final snapshot, matching the disposable-data requirement. This
teardown path and its post-deletion Sydney audit were verified on 2 October
2026.
You can override the saved ID explicitly with
`make aws-teardown SESSION_ID=<id>`. If the saved file is absent, teardown uses
the only locally retained session; it refuses to guess when several remain.

To inspect the retained address after teardown, run
`make -C infra/aws ip-status`. When you no longer need the stable IP, release
it separately:

```bash
make -C infra/aws ip-release RELEASE_IP=1
```

Release refuses to run while the address is associated or a local session
still references it. It removes the persistent Terraform state only after AWS
confirms the address is gone. If the state directory is lost while AWS still
holds the address, `ip-allocate` refuses to create a duplicate; recover or
import that allocation before deploying again.

## Verified design

The final design uses private RDS PostgreSQL 16 on `db.t4g.micro` with 20 GiB
encrypted gp3 storage. On 2 October 2026, an actual Sydney deployment restored
the complete frozen serving export: all 118 table-count and sequence records
matched, as did the extensions. TLS verified the RDS certificate and hostname,
and the local SSH tunnel reached the private database and completed PostgreSQL
TLS negotiation. The subsequent teardown deleted all 13 session resources,
including RDS and its backups, and the Sydney audit found no remnants.

RDS adds separate compute and storage costs. Stopping it continues storage
charges, and AWS restarts it after seven days; explicit teardown is needed to
remove ongoing resource charges. See [AWS stop/start behaviour](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html).
