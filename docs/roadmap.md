# Roadmap — Sprint 2 → Sprint 5

**Kea Energy · Scenario 9 · Team HAKAS · MIT Internship 2026**
Status: living document · Written 20 Aug 2026 (Day 4 of Sprint 2) · Owner: maintainer

> **The shape of the plan in one paragraph.** Sprint 2 ships a local-first MVP that
> proves the guarantee: every number computed and verified, running on one laptop with
> no internet. Sprints 3 and 4 keep that pipeline byte-for-byte and move the *transport*
> to AWS — Amazon Connect for the phone and chat channels, Bedrock behind the existing
> provider seam. Sprint 5 measures, polishes and pitches. **The four layers never change.
> Everything else is plumbing around them.**

Sprint 2 dates are fixed. Sprints 3–5 are **assumed two-week blocks** and must be
confirmed against the course calendar — see [Decisions needed now](#decisions-needed-now).

| Sprint | Dates | Theme | Ends with |
|---|---|---|---|
| 2 | 17–28 Aug | Local MVP | A demo that runs offline on one laptop |
| 3 | 31 Aug – 11 Sep *(assumed)* | Cloud foundations | The same pipeline running on AWS |
| 4 | 14–25 Sep *(assumed)* | Connect: voice + chat | A real phone number that answers |
| 5 | 28 Sep – 9 Oct *(assumed)* | Measure, polish, pitch | The final deliverable |

---

# Part 0 — Where we actually are

Honest status as of Day 4. This section exists so the plan starts from reality rather
than from the board.

| Fact | Consequence |
|---|---|
| It is **Day 4 of 10**; the board still shows Day 2 as "today" | The board is two days stale. Fix it before standup |
| **~38 cards remain** across 7 working days | Sprint 2 as scoped will not finish. Cutting is not optional — it is the plan |
| Day 3's walking skeleton (KEA-64) is still open | This is the highest-risk item. Nothing downstream is proven until it closes |
| **R4 (persistence) is a Sprint 2 must-have and is unbuilt** | Demo line 6 has no data. Every conversation run today is evidence being deleted |
| `make db && make api-migrate && make api-seed` **has never run** | An unknown of unknown size sitting on the critical path |
| The demo script is **DRAFT** with unconfirmed households | Everything downstream derives from it, and it has been open since Day 2 |
| The golden set does not exist | Prompt tuning is blocked, and G1's measurement has no instrument |
| One person owns backend + AI + Connect | Single point of failure on the most important part of the project |

**What is genuinely solid:** the architecture, 105 passing tests, the repo structure, the
ADRs, and a fallback path that already degrades correctly when the model is missing. The
foundations are better than the schedule.

---

# Part 1 — Sprint 2: the seven days left

## The cut line

Not everything survives. Decide this now, in daylight, rather than at 11pm on Day 9.

**Ship-blocking — the demo does not exist without these**

- [ ] Walking skeleton: React → `/chat/stream` → real model → verified answer (KEA-64)
- [ ] Postgres verified end to end on the **demo machine**
- [ ] Persistence of turn / fact bundle / verification / token usage (**R4**)
- [ ] The seven demo-script lines, each working against a named household
- [ ] Golden set + the "0 fabricated figures" number (**G1**)
- [ ] Fallback video

**Valuable, cut if Day 8 arrives and the skeleton is shaky**

- [ ] Local voice (VAD → whisper.cpp → Piper). Already feature-flagged in the risk register
- [ ] Weather normalisation, if the NIWA source has not resolved
- [ ] Year-on-year comparison (KEA-69) — currently a routable intent with no analytics

**Already deferred, do not restart**

- Appliance disaggregation · real billing integration · production auth · fine-tuning

> ### The voice question you must answer this week
>
> ADR-0003 specifies a **local** voice stack: Silero VAD, whisper.cpp, Piper, WebSocket.
> From Sprint 4, Amazon Connect provides STT, TTS and telephony itself.
>
> So: **is 1.5 days of local voice in Sprint 2 worth building something Connect replaces?**
>
> The honest case for yes: it proves ADR-0003's central claim — that voice is a transport
> skin and the pipeline is unchanged — while everything still runs offline. That is a
> strong demo moment and it de-risks the Connect work by proving the seam first.
>
> The honest case for no: it is a day and a half you do not have, spent on code with a
> known expiry date.
>
> **Recommendation: keep it, but only if the skeleton and persistence are done by end of
> Day 6.** Otherwise cut it and say so out loud in the review — a deliberate cut is a
> project-management decision, an undelivered card is a miss.

## Day by day

### Day 4 — Thu 21 Aug (today) · unblock everything

- [ ] **Update the board.** It is two days stale and it is what the team plans from
- [ ] **Confirm the seven demo lines with the team.** Open since Day 2, blocks everything
- [ ] **Reconcile household IDs** — the script says `H-A`…`H-D`, the code seeds `H-JUL`,
      `H-COLD`, `H-SPIKE`, `H-DROP`, `H-TARIFF`. Pick one set and change the other
- [ ] **Run the Postgres path on the Mac**: `make db && make api-migrate && make api-seed`.
      Timebox 2 hours. If it fails, that is today's work and nothing else is
- [ ] **Email VJ about AWS access** (see [Sprint 3](#part-2--sprint-3-cloud-foundations)) —
      lead time is the risk, not effort

### Day 5 — Fri 22 Aug · the walking skeleton

- [ ] KEA-64: end-to-end with a real model. Ugly is fine; it only has to prove the wiring
- [ ] KEA-66: model warm-up + UI ready state
- [ ] KEA-65: verify on a second machine
- [ ] **R4: persist turn, fact bundle, verification, token usage**

> Do R4 *now*, not on Day 9. Every conversation between today and then is evidence for
> demo line 6 that you are throwing away, and `narrator.py` already says it: *"it is not
> debug output, it is the deliverable."*

### Day 6 — Mon 25 Aug · analytics depth

- [ ] Repository layer replaces `fixtures.py` — real data through the real pipeline
- [ ] Verify the July household reproduces the published figures **through the pipeline**
- [ ] Weather normalisation, *if* NIWA resolved. Timebox 2 hours, then decide
- [ ] Low Fixed Charge modelling (ranked #1 of five jobs in the brief, needs no new data)

### Day 7 — Tue 26 Aug · evidence

- [ ] **Golden set: 30–50 question/expected-fact pairs**, including adversarial ones
- [ ] Wire it into CI. This is G1's instrument
- [ ] Model bake-off: gemma3:4b vs qwen3:4b against the golden set
- [ ] **Only now may prompts be tuned.** Before this, tuning is unfalsifiable

### Day 8 — Wed 27 Aug · 🎯 milestone + compliance

- [ ] Hardship detection → escalation, verified against demo line 5
- [ ] `GET /api/verification/log` + the rejection-log view (KEA-48, demo line 6)
- [ ] Voice **or** the deliberate decision to cut it
- [ ] **Feature milestone: chat working end to end**

### Day 9 — Thu 28 Aug · measurement

- [ ] Run the golden set. Record: **N prompts, 0 fabricated figures**
- [ ] Latency percentiles against the ADR-0003 budget. Report honestly
- [ ] Cost projection against published Bedrock rates — labelled a projection, page cited
- [ ] **Full demo rehearsal, cold, on the demo machine**

### Day 10 — Fri 29 Aug · ship

- [ ] Second cold rehearsal
- [ ] **Record the fallback video** — live demos fail; a video that plays beats an apology
- [ ] Sprint review + retro; update the risk and tech-debt registers
- [ ] Write the Sprint 3 board

---

# Part 2 — Sprint 3: cloud foundations

**Goal: the identical pipeline, running on AWS, with nothing about layers 0–3 changed.**

No Connect yet. Connect cannot call a laptop, so the API has to be reachable first — and
doing both at once means debugging two unfamiliar things through each other.

## 🔴 Do this in Sprint 2, not Sprint 3

- [ ] **Email VJ now** requesting: an AWS account or credits, permission to enable
      **Amazon Connect** in `ap-southeast-2`, budget approval to claim a phone number,
      and Bedrock model access in the same region
- [ ] Ask whether the course has a preferred landing zone or billing constraints
- [ ] Ask what Kea's actual contact-centre platform is — if they already run one,
      augmenting beats replacing, and that changes the pitch

> Account provisioning, Connect enablement and Bedrock model access all have **approval
> lead times measured in days**. Effort is small; waiting is the risk. This is the single
> most time-sensitive item in the whole roadmap.

## Workstream A — Get it deployed

- [ ] Choose the compute target and write it as an **ADR-0008**. App Runner or ECS
      Fargate are the obvious candidates; Lambda fights the model warm-up requirement
- [ ] Containerise the API
- [ ] RDS Postgres in `ap-southeast-2`; run the existing Alembic migrations against it
- [ ] Secrets via Secrets Manager or Parameter Store — **never environment variables
      holding long-lived keys**
- [ ] HTTPS, a domain, and health checks wired to `GET /api/health`
- [ ] **Authentication.** There is none today. Connect will call this endpoint from the
      public internet, and it answers questions about people's power bills

## Workstream B — Bedrock behind the existing seam

- [ ] Implement `BedrockProvider` — the stub and the interface already exist (ADR-0004)
- [ ] Run the **golden set against Bedrock** and compare with the local model
- [ ] Record real token usage and cost per conversation
- [ ] Keep `KEA_PROVIDER=ollama` working. The offline demo is a differentiator, not legacy

## Workstream C — Keep the evidence

- [ ] Verification log persists in RDS
- [ ] The "0 fabricated figures" claim now spans both providers
- [ ] Data-residency position written up: what leaves NZ, what does not, under which
      principle of the Privacy Act 2020

### Sprint 3 exit criteria

- [ ] The seven demo lines pass against the deployed API
- [ ] Golden set green on Bedrock
- [ ] The local offline demo still works, unchanged
- [ ] Cost per conversation measured, not estimated

---

# Part 3 — Sprint 4: Amazon Connect

**Goal: a real phone number a person can ring, and a chat channel, both answered by the
same pipeline.**

## Workstream A — Connect instance and telephony

- [ ] Create the Connect instance in `ap-southeast-2`
- [ ] Claim a DID number — **billed from the day you claim it**
- [ ] Contact flow v1: greeting → capture utterance → invoke Lambda → speak the response
- [ ] Lambda adapter: Connect event → `POST /api/chat` → response
- [ ] **Use `/api/chat`, not `/api/chat/stream`.** A phone line has no DOM to stream into,
      and Connect wants a synchronous response. The endpoint you need already exists

## Workstream B — The channel model

- [ ] Add `phone` to `conversation.channel` — **the column already exists**, no migration
- [ ] Store the Connect contact ID against the conversation for cross-referencing
- [ ] Verify the guarantee holds: **voice cannot produce an answer chat would not**

## Workstream C — Escalation, which is the compliance story

- [ ] `escalate_to_human: true` → Connect transfers to a live agent queue
- [ ] Record it in the `escalation` table
- [ ] Demo it end to end: hardship utterance → detected → transferred to a human

> This is the strongest single moment available to you in the whole project. Under the
> Consumer Care Obligations, routing a distressed customer to a person is closer to a
> legal duty than a feature — and you can *show* it working on a real phone call.

## Workstream D — Connect chat

- [ ] Connect chat widget for the retailer's site, same Lambda, same pipeline
- [ ] **Decide and write down** how this relates to the React app. Recommended split:
      Connect chat is the *website* channel; the React app is the *customer portal*.
      Two front doors, one brain — do not let them drift into two products

## Workstream E — Latency

- [ ] Measure the real phone round trip against ADR-0003's 2-second budget
- [ ] Expect it to be worse than local: network hops plus Bedrock instead of on-device
- [ ] Pre-synthesised acknowledgements while the answer generates (the ADR-0005 shape —
      layer 0 knows the intent in ~0 ms, so the acknowledgement cannot fabricate)

### Sprint 4 exit criteria

- [ ] A phone number that answers a bill question correctly
- [ ] Hardship call transfers to a human
- [ ] Chat and phone give the same answer to the same question
- [ ] Every figure still traces to a computed fact

---

# Part 4 — Sprint 5: measure, polish, pitch

- [ ] **The deflection business case with real numbers**: measured handle time, measured
      cost per conversation, sourced NZ agent cost, stated FX assumption
- [ ] Latency percentiles across all three channels
- [ ] Golden set final run — the headline evidence number
- [ ] Final pitch deck and rehearsals
- [ ] MIT individual report; contribution log current
- [ ] Fallback video for **every** channel, including the phone call
- [ ] Tech-debt and risk registers closed out honestly

---

# Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | **AWS access arrives late** and blocks Sprints 3–4 | High | Email VJ today. Track it as a card with a date, not a hope |
| R-2 | **Bus factor 1** — one person owns backend, AI and Connect | High | Pair someone on the Connect work in Sprint 3. Document as you go |
| R-3 | Sprint 2 does not finish | High | The cut line above. Decide by Day 8, not Day 10 |
| R-4 | Postgres path fails on the demo machine | Medium | Timeboxed to Day 4. It has never run |
| R-5 | Connect phone latency breaks the illusion | Medium | Pre-synthesised acknowledgements; measure early in Sprint 4 |
| R-6 | Connect costs more than projected | Low | Billing alarm from day one. Deflection maths says ~$2k/yr against ~3,159 agent-hours |
| R-7 | **The "runs offline" claim conflicts with Connect** | High | See below — resolve before the pitch |
| R-8 | Golden set slips and G1 has no instrument | Medium | It is ship-blocking. Do not let it drift past Day 7 |

## R-7 in full, because it will be asked

`demo-script.md` instructs the presenter to say:

> *"this is running entirely on this laptop, no internet, no customer data leaving the device"*

— which answers the **47.6% who distrust AI with their usage data.**

Once voice runs through Connect and narration through Bedrock, that sentence is **false
for the cloud channels.** A judge who hears it in Sprint 2 and sees the Sprint 4
architecture will notice.

The honest reconciliation, decided now and said consistently:

> The analysis is deterministic and runs wherever it is deployed; meter data never
> reaches the model in either configuration. The local build proves the guarantee is
> real. The AWS build shows it scales. Audio and narration transit `ap-southeast-2`;
> here is the data-residency position under the Privacy Act 2020.

Weaker than the offline claim. Survivable. Being caught overclaiming is not.

---

# Decisions needed now

| # | Decision | Owner | Needed by |
|---|---|---|---|
| D-1 | Confirm Sprint 3–5 dates against the course calendar | Team | This week |
| D-2 | Confirm the seven demo lines and reconcile household IDs | Team | **Today** |
| D-3 | Build local voice in Sprint 2, or cut it for Connect? | Maintainer | Day 6 |
| D-4 | Spike-detection method: published (10.9%) or generic 1.5× (16.4%) | Team | Before analytics depth |
| D-5 | §5 brief amendment — voice-as-feature vs voice-as-call-deflection | Brief owner | Before the pitch |
| D-6 | Compute target for the deployed API → ADR-0008 | Maintainer | Sprint 3 planning |
| D-7 | Connect chat vs the React app — which is which | Team | Sprint 4 planning |
| D-8 | How the offline claim is phrased once AWS is in play (R-7) | Team | Before the pitch |

# ADRs to write

| ADR | Subject | When |
|---|---|---|
| 0007 | Amazon Connect as the voice and chat transport | Now, while the reasoning is fresh |
| 0008 | Compute target for the deployed API | Sprint 3 planning |
| 0009 | Data residency and what crosses the NZ border | Sprint 3 |
| 0010 | Authentication on the public API | Sprint 3 |

---

## Related

- [`prd.md`](prd.md) · [`api-standards.md`](api-standards.md) · [`erd.md`](erd.md)
- [`adr/`](adr/) · [`sprints/`](sprints/) · [`teams/`](teams/)
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
