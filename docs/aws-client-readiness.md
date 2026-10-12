# AWS client readiness

The main-target changes replace website billing, usage and plan placeholders with account API reads; hide solar, battery and EV equipment when the account has no verified assets or instantaneous power readings; and add authenticated mobile writes. Presentation scripts belong only on `sprint-5-AWS-Presentation`.

## Backend rollout

For live AI, set `KEA_PROVIDER=bedrock`, `AWS_REGION` and `KEA_BEDROCK_MODEL` in server configuration. The resolver selects the boto3 Converse adapter for `amazon.nova-*` model IDs and the Anthropic SDK adapter for Claude models/inference profiles. Select a model supported by the chosen adapter and enabled for the deployment region. The EC2 Compose file no longer overrides the cloud engineer's model setting. Supply `KEA_BEDROCK_MODEL` through protected runtime.env or the deployment's SSM prefix; a new EC2 session writes `amazon.nova-pro-v1:0` into runtime.env, since the account's SCP blocks Claude models in Sydney, and a credential refresh keeps whatever the line says; the bootstrap loads SSM before importing API settings. The API image includes both SDKs. Provide an IAM role or protected short-lived server credentials, and verify `/api/health` reports `model_ready: true` plus an actual streamed tool-using answer before release. Never put AWS credentials in Vite or Expo public variables. Claude configuration: [Anthropic Bedrock documentation](https://docs.anthropic.com/en/api/claude-on-amazon-bedrock).

Apply Alembic through `0012_invoice_history` using the approved deployment process. `0011` adds app-owned private `client_state`; `0012` creates a read-only `app.invoice_history` view when the existing `billing` and `kea` serving schemas exist. The migration owner needs SELECT on `billing.bill`, `billing.account`, `billing.payment` and `kea.mart_daily_usage`; the API role needs SELECT on the view and access to app-owned tables. No serving replica tables are rewritten. Preview databases without these schemas retain explicitly estimated billing; an existing empty view means no issued invoices, rather than fabricated fallback invoices. Payments and issued invoices are cut off at the account's available-data date and `KEA_AS_OF`.

Set `KEA_AS_OF=2026-08-17` for the AWS snapshot ending on that date. Sparky receives both this story date and the account's latest available reading date. Update this setting when the serving snapshot advances.

Profile updates change contact name, email and phone only. Plan changes create review requests; they do not change the billed tariff. Feedback is stored per authenticated account/message. Attachments accept PDF/PNG/JPEG with validated signatures, at most 512 KB each and ten per account. Stored attachments are not automatically analysed by Sparky.

Set `KEA_ATTACHMENT_BUCKET` to a dedicated private S3 bucket, with all four Public Access Block settings enabled. The API checks these before upload and uses SSE-S3 encryption. Its IAM role needs `s3:GetBucketPublicAccessBlock`, `s3:PutObject` and `s3:DeleteObject` for this bucket's attachment prefix. Add a retailer-approved retention lifecycle; files are removable through the account-scoped DELETE endpoint. No public object URL is returned. Local previews store files in memory and discard them on restart.

## Payments

No retailer card provider has been selected. Payment and saved-card routes return HTTP 501; no charge is taken and no card details are collected. Clients show issued-invoice bank-transfer guidance without inventing bank account details. A provider integration, settlement evidence and retailer approval are required before enabling card payment.

## Alerts and phone delivery

`KEA_ALERT_ACCOUNTS` accepts comma-separated account IDs; positional CLI IDs override it. `KEA_ALERT_LIMIT` bounds the selected accounts (zero means unlimited). Unrestricted evaluation keeps the existing all-account behavior. A scoped run skips deferred releases to prevent sends for other accounts. Use explicit test accounts before enabling external channels.

Device notification registration is account authenticated and opt-in from mobile Settings. Tokens are revoked on sign-out, refreshed only while opted in, expire after 24 hours without refresh and have one current account owner. An account switch cannot be overwritten by a late send response. Expo delivery is off until `KEA_EXPO_PUSH_ENABLED=1`; it also requires enabled alert preferences, an enabled evaluator and persistence. Quiet hours suppress pushes. Payloads contain generic text and open the authenticated dashboard. Send tickets record acceptance, not delivery; immediate `DeviceNotRegistered` errors remove tokens. Expo receipt polling and measured delivery on an EAS development/release build remain release checks.

The EC2 Connect flow reads the gateway's `kea_notice_audio` S3 attribute. The notice directs users to app Settings or Customer Care; it no longer promises unsupported keypad actions. The API image already contains ffmpeg. Verify synthesized audio, outbound permissions, destination and contact receipts in the deployed environment. No-Lambda SES/SNS receipt ingestion and Connect reconciliation from issue #374 are separate infrastructure work.

`python -m app.release_readiness --sandbox` permits a non-production persisted demo configuration; it does not waive required API authentication, transport or provider checks. Adding `--aws` makes read-only AWS probes. Production SES access is waived only in sandbox mode; recipient verification and actual delivery still need AWS evidence. No AWS probe, migration or external notification was executed while implementing these changes.

## Phone model hosting

Set `EXPO_PUBLIC_PHONE_MODEL_URL` before bundling to an HTTPS model URL (for example an approved AWS HTTPS origin). The default upstream URL is retained. File size, pinned SHA-256 and model identity remain unchanged; an override cannot select an unrelated model. A physical development build is required to verify the native download and inference; Expo bundle exports do not prove native inference.
