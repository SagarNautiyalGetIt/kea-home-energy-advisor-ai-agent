# AWS deployment plan — Kea Energy demo

**Final architecture: EC2 application containers + private RDS PostgreSQL 16
in Sydney.** RDS creation, complete database restore, certificate-verified TLS
and access through an EC2 SSH tunnel were verified on 2 October 2026. The
data-processing pipeline stays local; its PostgreSQL serving export is imported
into AWS. The Cloud Owner controls teardown. There is no automatic termination
timer.

## Resources and access

| Item | Configuration |
| --- | --- |
| Account / region | Team account `022499038388`, Sydney `ap-southeast-2` |
| Operator identity | `kea-energy` AWS SSO profile |
| Application compute | Amazon Linux x86-64 EC2 `t3.medium` (4 GiB, sized for Metabase beside the API), no IAM instance profile |
| Application storage | 20 GiB encrypted gp3 EBS, deleted with the EC2 session |
| Database | RDS PostgreSQL `16.15`, `db.t4g.micro`, Single-AZ in `a` by default (`TF_VAR_db_availability_zone`) |
| Database storage | 20 GiB encrypted gp3; no storage autoscaling configured |
| Database network | Private endpoint, port 5432 allowed only from the application security group |
| Database authentication | Ordinary PostgreSQL login `kea` and password, certificate-verified TLS; read-only `kea_metabase` for Metabase |
| Reporting | Metabase `v0.63.15` at `https://<ip>/metabase/` with the demo walkthrough dashboard; its own H2 store on the host |
| Database administration | Separate `kea_admin` login used only for setup and import |
| Backend debugging | SSH tunnel through EC2 to local `127.0.0.1:15432`; separate teammate SSH and PostgreSQL accounts |
| Backups | One-day automated backup retention while the database exists |
| Public application address | Retained Sydney Elastic IP; released only by `ip-release` |
| Model | Sydney Bedrock Nova Lite, using temporary team SSO credentials |
| Alert email | Amazon SES, sandbox; verified recipients only |
| Alert SMS | Amazon SNS, sandbox; verified numbers only, USD 1 monthly spend cap |
| Alert phone calls | Amazon Connect instance, claimed NZ number and call flow; optional per session (`ENABLE_VOICE_ALERTS=1`), off by default |
| Lifecycle | Manual session teardown deletes EC2, RDS, any Connect instance and their session network; retains Elastic IP and local export |

## Architecture

![Kea Energy AWS architecture: clients reach one EC2 host through the retained
Elastic IP; the host's containers use private RDS and Sydney Bedrock; the Cloud
Owner's laptop provisions, restores and tunnels](architecture.png)

Dark arrows are the running application and grey arrows the Cloud Owner's
operations; dashed arrows are certificate validation, alert delivery (off for
now), the database restore and the tunnel. The source is [architecture.drawio](architecture.drawio). After
editing it in draw.io, export the image again from `infra/aws/` (on macOS the
CLI is `/Applications/draw.io.app/Contents/MacOS/draw.io`):

```bash
draw.io -x -f png -s 1.5 -b 20 -o architecture.png architecture.drawio
```

[ec2/main.tf](ec2/main.tf) and [ec2/rds.tf](ec2/rds.tf) manage one session's
VPC, public application subnet, two private database subnets, internet gateway,
route table, security groups, SSH key, EC2 instance, RDS subnet group and RDS
instance. The database subnet group spans Sydney AZs `a` and `b`, while the
Single-AZ database itself runs in `a` unless `TF_VAR_db_availability_zone`
moves it to `b`: on 6 October 2026 AWS had no `db.t4g.micro` capacity in `a`
(`InsufficientDBInstanceCapacity`). The private subnets need no NAT gateway.
A separate [address/](address/) Terraform state retains the Elastic IP between
future deployments.

[ec2/compose.yml](ec2/compose.yml) runs the website, API/Piper, evaluator and
Metabase. Caddy serves Metabase at `/metabase/` on the same port 443, so it
needs no security-group rule. Metabase reads RDS as the read-only
`kea_metabase` login and never receives the API's runtime file or its AWS
credentials. The PostgreSQL container image is used only as a short-lived client for
`psql` and `pg_restore`; it does not run the deployed database server. The
API port remains private to Docker. EC2 permits HTTP 80 for certificate
validation, HTTPS 443 for clients, and SSH 22 from the owner's IPv4 `/32`.
The RDS endpoint is never exposed directly to web browsers or mobile apps.
Backend debugging uses an SSH local-port tunnel through EC2; RDS remains
private and each teammate uses an individually authorized SSH key and database
account.

## Alert delivery

Bill-shock alerts use **SES for email, SNS for SMS and Amazon Connect for phone
calls**. All three were tested from this account on 2 October 2026 and reached
a real inbox or NZ mobile. Connect's own email and SMS features are not used:
its email runs on SES, and its SMS needs End User Messaging numbers, which
offered no AU or NZ voice numbers here. Delivery stays off
(`KEA_ALERTS_ENABLED=0`) until the backend gateways for these services exist in
`services/api/app/alerts/channels.py`.

| Channel | Service | Provisioning | Limit today |
| --- | --- | --- | --- |
| Email | SES (`sesv2.send_email`) | Account-level; sender and recipients verified once, outside Terraform | Sandbox: verified recipients only, 200 per day |
| SMS | SNS (`sns.publish`, Transactional) | Account-level; recipients verified once in the SMS sandbox | Sandbox: verified numbers only, USD 1 per month |
| Phone call | Connect (`connect.start_outbound_voice_contact`) | [ec2/connect.tf](ec2/connect.tf): instance, claimed NZ DID number and a flow that speaks the contact attribute `message`, created with the session when `ENABLE_VOICE_ALERTS=1` | Billed per session while the number is held; the caller number changes each session |

The API and evaluator call these services with the same temporary SSO
credentials as Bedrock, so alerts stop when those credentials expire. Reaching
real customers needs AWS support cases: SES production access with a
team-owned domain verified by DKIM, and an SMS spend-limit increase. The Connect
flow's spoken attribute has not yet been tested with a live alert.

## IAM boundary

This configuration creates no custom project IAM role. The EC2 host has no
instance profile, and PostgreSQL connections use database passwords rather
than IAM database authentication. Enhanced Monitoring is disabled, so its
additional monitoring role and `iam:PassRole` are unnecessary.

RDS still uses AWS's service-linked role `AWSServiceRoleForRDS`. The operator
cannot read IAM roles in this account, so verification did not establish whether
that role existed already or AWS created it internally. The account accepted
the actual RDS creation request and reached `available` without the team manually
creating or passing a custom role. Amazon Connect likewise uses its AWS-managed
service-linked role; the account accepted a test instance on 2 October 2026.
Never alter the university's AWSAccelerator,
ControlTower or CloudHealth resources.

## Deployment flow

1. Refresh `kea-energy` SSO and verify the team account and Sydney region.
2. Pause local application writes and pipeline publishing, then export the
   PostgreSQL 16 serving database. `SOURCE_PAUSED=1` confirms that the owner
   has performed that pause; it does not pause writers automatically.
3. Allocate or reuse the retained Elastic IP, create the session directory and
   SSH key, and generate separate administrator, application and Metabase
   passwords.
4. Review and apply Terraform to create EC2, private RDS and the session network.
   Terraform 1.11+ supplies the administrator password through an ephemeral
   variable and the provider's write-only `password_wo` argument. Neither state
   nor saved plans store that password.
5. Prepare Docker and PostgreSQL client tooling on EC2. Download the official
   RDS CA bundle and mount it read-only in the API and evaluator containers.
6. Build and transfer the API and web images. Issue and install a trusted,
   short-lived HTTPS certificate for the EC2 public address.
7. Install mode-0600, root-owned runtime and database client files over SSH.
   The API runtime contains its PostgreSQL login and temporary Sydney Bedrock
   credentials. The administrator client file is separate from the API runtime.
8. Create the ordinary PostgreSQL application owner `kea` and the login
   `kea_metabase`, which has no privileges yet. Restore with
   PostgreSQL 16 `pg_restore --role=kea --no-owner --no-acl --exit-on-error`,
   then remove the administrator client file from EC2. Verify every exported
   table count, sequence state, extension and encrypted connection before
   running Alembic migrations.
9. Start API and web containers, install the hourly evaluator systemd timer,
   and verify HTTPS, login and database-backed usage. Bedrock and voice checks
   also require current model credentials. Alert delivery remains disabled
   (see [Alert delivery](#alert-delivery)).
10. Pin the served data to the story date with
    `data/pipeline/scripts/ops/serving_as_of.sql` (the newest forecast date), so
    the app opens on the walkthrough's billing cycle rather than the end of the
    generated span. As `kea`, grant `kea_metabase` read access to the `kea`,
    `billing`, `metering` and `catalogue` schemas, start Metabase, then connect
    it and build the walkthrough dashboard with the `data/analysis/metabase`
    builders. `make -C infra/aws metabase` is safe to repeat.
11. Build the Android APK for the HTTPS API URL. Install it only through the
    separate `install-apk` command when requested. Keep the deployment running
    until the Cloud Owner requests teardown.

The [operator README](README.md) and [Makefile](Makefile) contain the executable
commands. The root entry points remain:

```bash
make aws-deploy SOURCE_PAUSED=1
make aws-db-tunnel
make aws-teardown
```

`aws-deploy` saves the new session ID in ignored `.work/session.env`. To operate
on a different retained session, pass `SESSION_ID=<id>` explicitly.
`aws-db-tunnel` exposes private RDS only at `127.0.0.1:15432` while the command
runs. It does not change RDS public accessibility.

## Verification evidence and limits

The 2 October RDS verification used a checksum-verified, previously frozen export from
1 October 2026, 07:06 UTC. It did not export or pause the current local database.
The private RDS connection verified both the CA chain and endpoint hostname.
All **118 table-count and sequence-state records**, plus the extension list,
matched the source manifest. RDS reports PostgreSQL 16.15, encrypted storage,
private accessibility and `available`. The EC2 host reports no IAM instance
profile. Terraform validation and the deployment credential tests pass.

The SSH tunnel command was tested against the private endpoint, which accepted
a PostgreSQL TLS negotiation through EC2. Each fresh deployment still runs its
own API, login, database-backed usage and HTTPS checks before it is accepted.
The validation session teardown then deleted all 13 managed resources without
a final RDS snapshot. A Sydney audit confirmed that its EC2 instance, RDS
database and backups, VPC, EBS volume and supporting resources were absent.

## Operation, cost and teardown

RDS isolates database resources from API/Piper and supplies managed database
maintenance and automated backups. This adds separate database compute and
storage charges to the existing EC2 cost; it is a managed-service choice,
not a cost saving compared with sharing the same EC2 instance.

The team's allowance is NZD 200. Review actual billing before leaving the demo
running for an extended period. A stopped RDS database continues storage charges
and automatically restarts after seven days. The retained Elastic IP is charged
even without an attached instance. A session deployed with voice alerts also
pays for its claimed Connect number and per-minute calls. SES and SNS charge
per message; SNS SMS is capped at USD 1 per month. There are no automatic stop
or deletion jobs.

When the owner invokes teardown, Terraform deletes RDS and its automated backups
without a final snapshot, deletes EC2 and its root volume, releases any Connect
number and deletes its instance, and removes the session network. Local exports,
the separately managed Elastic IP and the verified SES and SNS recipients are
kept. The audit checks that the session database, its automated backups and DB
subnet group, any Connect instance, and other resources are absent before
removing local state. If any deletion is denied or incomplete, retain the state for recovery.
The AWS RDS service-linked role is outside this Terraform stack and is not deleted.

The IP certificate requires renewal roughly every six days. Temporary Bedrock
credentials require refresh before their printed expiry. A database password
connection does not depend on that SSO expiry. The Cloud Owner chooses when to
renew, refresh or tear down the stack.

## References

- [AWS RDS service-linked roles](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAM.ServiceLinkedRoles.html)
- [RDS PostgreSQL TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)
- [RDS database subnet groups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html)
- [RDS stop/start billing and seven-day restart](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html)
- [AWS CLI temporary SSO credential export](https://docs.aws.amazon.com/cli/latest/reference/configure/export-credentials.html)
- [Let's Encrypt IP certificates](https://letsencrypt.org/2026/03/11/shorter-certs-certbot)
