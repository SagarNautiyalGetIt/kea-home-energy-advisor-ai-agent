# Sparky release research and evaluation protocol

Research checked 3 October 2026. Product recommendations below are inferences from the
listed primary sources; neither overseas energy results nor simulation results establish
a savings effect for Kea customers. The code distinguishes planned, measured and unavailable
data. No new savings percentage, outage coverage or retailer benefit is claimed.

## Where scheduled outages belong

The decision is a dedicated **Scheduled outages** page, reached from More, plus a contextual
Home notice beside the home's energy readings. Home answers "what affects my home now?";
the dedicated page handles dates, source, changes, cancellations and preparation. It belongs
outside billing and games because an outage can affect any customer, including people with
no bill warning or competition participation. This placement is a design inference.

[Vector's planned-outage service](https://help.vector.co.nz/planned) links information to a
property. Its [outage guidance](https://vector.co.nz/help-and-support/power-outages) distinguishes
network interruption reporting from scheduled work. A whole-house meter and an account's
region cannot establish that a specific property is affected. The release therefore accepts
signed household snapshots from an approved distributor source, rather than guessing an API
or scraping an address list. A team integration must map ICP/address to the correct account.

Each snapshot records source URL, distributor, fetched time, expiry and increasing revision;
full replacements preserve cancellations. Missing or older-than-six-hour snapshots are
explicitly unavailable/stale. An empty fresh schedule only means the linked source lists no
scheduled notices; unexpected faults remain possible. The page shows preparation advice
without suggesting that app monitoring guarantees supply.

The [Electricity Authority's medical-dependency guidance](https://www.ea.govt.nz/your-power/consumer-care-obligations/if-you-rely-on-electricity-for-medical-reasons/)
and [Consumer Care Obligations](https://www.ea.govt.nz/projects/all/consumer-care-obligations/)
make care and contingency planning material design constraints. The app must keep emergency
advice accessible and route support to people; badges and points cannot replace this care.
The release suppresses automated bill escalation after recorded hardship and does not reward
reducing essential heating or medically necessary use.

## Motivation and proactive savings

[Allcott and Rogers' randomized field research](https://www.nber.org/papers/w18492) studies
repeated home energy reports and persistence. It supports testing timely repeated feedback,
not assuming that any animated mascot produces the same effect. The design inference is to
make Sparky useful at the moment of a decision: an actual tariff comparison, a feasible EV
charge plan before departure, an explained bill change or a sourced outage preparation question.

[Allcott and Kessler's welfare research](https://www.nber.org/papers/w21671) examines costs and
benefits of behavioural nudges, including heterogeneous household preferences. Engagement
is therefore not the sole success metric: opt-outs, annoyance, effort and comfort are outcomes.
Sparky uses restrained encouragement, asks before changing routines, and labels itself AI.
It does not infer a customer's emotional state from usage or pretend to be a human friend.
Emotional voice delivery styles the verified words; it cannot add claims or choose actions.

Power Clash has separate planning XP (five per mission/local day) and device-verified XP.
Signed receipts include tariff ID, measured intervals, shifted kWh, actual peak/off-peak rates
and comfort confirmation. Awards are account-isolated and deduplicated by mission/day;
renaming a receipt cannot farm extra points. XP is not money and a plan is not a charger action.
The displayed tariff difference is an estimate against the reported peak-window alternative,
not a measured causal reduction in the final invoice. Existing league simulations remain labelled.

The [US Department of Energy's demand-response material](https://www.energy.gov/cmei/better-buildings-residential-network/articles/demand-response-programs-and-their-impact-peak)
provides context for peak management. [Coordinated EV charging research](https://arxiv.org/abs/1112.0697)
shows why simultaneous shifting can create another peak; it is modelling evidence, not an
observed Kea outcome. Kea should stagger recommendations within eligible tariff windows,
preserve departure targets and customer comfort, and measure the aggregate feeder/portfolio peak.

Customer savings and retailer savings need separate ledgers. Customer cost uses effective
GST-inclusive tariffs and actual billing periods; retailer value depends on marginal wholesale
settlement, hedges, network charges, implementation costs and service workload. A retail price
difference cannot be entered as Kea's avoided wholesale cost. No current code claims this benefit.

## Preregistered experiment

Before rollout, register the analysis window, assignment seed, primary outcome and exclusions.
Use household-level random assignment with a holdout: existing app; contextual Sparky coaching;
coaching plus evidence-labelled XP. Stratify by tariff, baseline usage, EV availability and
data completeness; calculate sample size from measured variance and an agreed minimum useful
effect. Do not invent a power calculation without these inputs.

- Primary customer outcome: change in NZD energy cost using actual interval tariffs, compared
  with randomized holdout and adjusted baseline; report confidence intervals and attrition.
- Primary system outcome: coincident peak kW/settlement-window exposure for the portfolio,
  with actual marginal costs supplied by the retailer's finance/market team.
- Secondary: verified kWh shifted, tariff-fit decisions, task completion, time to useful answer,
  repeated voluntary use, care resolution and support workload. Separate plans from execution.
- Guardrails: discomfort/departure misses, underheating reports, medical-care incidents,
  complaints, channel opt-outs, false/late warnings and unavailable-data rates.

Use Pacific/Auckland interval timestamps including DST, dated effective tariff revisions and
meter/device mappings. Exclude outage windows from behavioural savings attribution using
prespecified rules; retain them in reliability reporting. Analyse by assigned group even when
users ignore coaching. Publish misses, negative effects and subgroup uncertainty. Stop or
revise a treatment if care guardrails worsen; increased chat volume alone is not success.

## Voice and cloud architecture evidence

[Gemini 3.8 Flash TTS](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts) and the
[speech-generation API](https://ai.google.dev/gemini-api/docs/speech-generation) provide
controllable spoken delivery. This adapter sends the exact verified answer with style metadata,
validates mono 16-bit WAV and uses the returned sample rate. It does not synthesize paid
acknowledgements at startup. TTS is separate from speech recognition, account reasoning and
voice transport; the shipped mobile page uses explicit recorded conversation turns.

[Connect outbound contact creation](https://docs.aws.amazon.com/connect/latest/APIReference/API_StartOutboundVoiceContact.html)
supports a client token and returns a ContactId; that is acceptance, not delivery.
[Connect prompt guidance](https://docs.aws.amazon.com/connect/latest/adminguide/play.html)
requires compatible media, so Gemini audio is converted to mono 8 kHz mu-law WAV in private S3.
The generic notice avoids exposing bills to voicemail or the wrong person. Deterministic digits
route to customer care or persistent opt-out; recovery prompts never claim an unsaved choice.

[SES production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
and the [SNS SMS sandbox](https://docs.aws.amazon.com/sns/latest/dg/sns-sms-sandbox.html) require
account-specific readiness checks. Enabling services alone does not verify send destinations.
SES events and SNS delivery logs update the ledger through an AWS-authorized receipt worker.
No credentials, paid voice probe, live send or AWS deployment was available for this research
verification. Those gates are specified in `infra/aws-runtime/README.md` and the QA checklist.
