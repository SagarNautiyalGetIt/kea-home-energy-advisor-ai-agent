# Sparky account questions

Sparky chooses tools dynamically from the customer's words and conversation history.
The request account is bound by the server; no tool accepts another account ID.
Configured production middleware verifies session ownership before chat starts;
the synthetic local prototype does not establish a deployed identity service.
This inventory describes evidence available to the assistant, not guaranteed model
accuracy for every possible wording. The backend must return a reason when data is absent.

| Customer question / entry point | Evidence and response boundary |
| --- | --- |
| “Why is my power bill so high?” / suggested question | Account summary + bill comparison; daily usage and help material when needed. Distinguish period length, tariff, weather and unexplained changes. No appliance guess. |
| “Which day was my highest usage?” / suggested question | Daily usage with exact dates and available period. |
| “Was that just the cold snap?” / suggested question | Bill comparison and daily weather/usage evidence. Explain fitted association and residual, not certain causation. |
| “Could another plan save me money?” / Plans | Meter-priced plan options + shared offer/term catalogue. Conditional credits are separate; absent interval data weakens TOU/free-window estimates. |
| “What about weekends?” / follow-up | Resolve the prior topic from history; hourly profile for average shape, dated history for actual weekends, plan details for free-window terms. |
| “How much do I owe?” / “When is it due?” / “Am I overdue?” | Account summary balance and due date. Missing billing record stays unknown. |
| “What is my daily charge?” / “Why pay while away?” | Current account rate + daily-charge help; current rate does not prove a historic invoice line. |
| “What is this credit/adjustment?” / “Show my last bill” | Current/prior invoice aggregates for totals/kWh/days. Actual charge lines, export credits, adjustments and invoice read-quality are unavailable; explain general terms without inventing personal amounts. |
| “Did you receive my payment?” / “Download all my invoices” | No transaction ledger/document archive tool. Do not infer payment from a prior invoice or claim a download exists. |
| “Show yesterday by hour” / “That spike at 7pm?” | Dated hourly tool, Auckland calendar, quality and missing hours; monthly profile is not a dated observation. |
| “What did I use last week/month?” / Usage | Dated usage history; report incomplete requested range and available dates. Explicit range maximum 366 days; default is the latest available year. |
| “How much peak/off-peak/night power?” | Same dated band analytics as Usage; a missing day's band prevents a complete band total. Demo bands are synthetic. |
| “What will my next bill be?” / Bill Prediction | Forecast plus current alert assessment. Range, method and energy-cost/invoice limits remain visible. |
| “Why didn't I get a text?” / “What are my warnings?” | Alert preferences, quiet hours, destinations and deterministic assessment. No delivery receipt is read: do not diagnose a specific failed delivery or promise a sent notification. |
| “Text me at 25% instead” / “Stop calling at night” | Existing reversible settings tool; validate ordered ladder, echo exact change. No implicit update for a question. |
| “Switch me to that plan” / “Yes, go ahead” | Existing stage/confirm pricing-style request. A separate later confirmation is required; recorded request is not an activated contract. Commitment terms cannot be changed by this tool. |
| “What's using my power?” / Settings scan | Household breakdown + mapped device energy; discovery gives names only, on the API server's network. |
| “Is my EV charging?” / “Is my battery full?” / “How much solar?” | Daily device/import/export data cannot establish live charger status, battery SOC or generation. A mapped sensor is needed. No charger/battery control tool. |
| “Plan charging before I leave” / EV Clash mission | Actual account plan, device energy and published offers. Ask for necessary departure/charge/capacity/power constraints. Unconfirmed contracted windows/rates prevent a personal savings claim. |
| “Move one flexible task” / Clash mission | Energy breakdown + tariff evidence + customer routine; protect essential equipment/comfort. Unknown device kWh stays unknown. |
| “How many points?” / “Why no XP?” / “Complete my quest” | Clash ledger separates planning and verified XP. No points minting/redemption; verified receipts cannot be created from chat. |
| “Prepare for an outage” / Scheduled Outages | Linked source-dated distributor notice + help facts. Missing/stale feed is not an all-clear; no guaranteed restoration time. |
| “Read my bill photo” / Bill Explainer | Use the upload flow; plain chat does not receive an attachment automatically. Validate extraction against the original. |
| “I can't afford this” / “My meter is wrong” / “Get a human” | Evidence/help + existing escalation tool. Concern recording does not imply staff delivery; use verified bill contacts. |
| “Move house” / “Change bank details” / “Close my account” | Explain supported process from reference material; these actions are unavailable. No payment credentials in chat. |
| “What's my email?” / “Change my phone number” | Use Profile for contact details; tools deliberately keep email/phone out of model context. No contact-edit tool. |
| “What is Sparky?” / accuracy/privacy/Help FAQs | Fact-based knowledge retrieval with product/regulatory/illustrative basis. No unsupported retention, deployment-security or competitor-comparison claim. |

## Verification and release acceptance

The new read tools share Usage/hourly analytics, the mobile plan catalogue and the
pure bill-shock calculation inputs. They never call the bill-shock HTTP GET, which
can dispatch notifications. Regression tests cover foreign-account arguments,
missing days/bands, synthetic demo labels, out-of-period dates, missing DST hours,
invoice/payment distinction, offer/contract distinction and read-only alert settings.

Scripted-provider tests verify that a trusted Auckland date reaches conversation
turns across midnight/DST; they do not validate a model's reasoning. Run the above
phrases, paraphrases and follow-ups with a ready provider before production acceptance.
Inspect recorded tool sources and compare every figure to the tool result. Include
accounts with no invoices, estimated/incomplete reads, a long billing period, unknown
contracted rates, no mapped device, stale notices and both planned/verified rewards.
Reject answers that invent data, silently change settings, claim delivery or say a
plan request has already activated. The local API at implementation time reports
`model_ready:false`, fixture data and memory preferences; live conversational and
durable deployment acceptance remain open.
