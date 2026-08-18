# Demo script — Day 10

**Status: DRAFT — fill this in before writing more code.**

This is the spec. Every intent, analytics function, seeded household and golden-set
case is *derived* from this list. Without it we build breadth nobody sees and discover
on Day 9 that the one path being demoed is the shallow one.

It is also scope defence: when someone proposes a feature on Day 6, the question
becomes *"which line does that serve?"* — a much easier conversation than a taste
argument.

## Rules

- **7 lines maximum.** A judged demo is minutes, not hours.
- Every line names the household it runs against.
- Every line states what the judge should conclude.
- If a line has no household that exhibits the finding, either seed one or cut the line.

## The script

| # | Question (typed or spoken) | Household | Intent | What the judge concludes |
|---|---|---|---|---|
| 1 | "Why was my July bill so high?" | H-A | `why_bill_high` | The spike everyone stares at isn't the money; the steady load is. |
| 2 | "Wasn't that just the cold snap?" | H-B | `why_bill_high` | We separate weather from behaviour instead of blaming the customer. |
| 3 | "What will I pay this month?" | H-A | `what_will_i_pay` | Dollars, mid-month, which is the unit 71.4% of respondents asked for. |
| 4 | "Which appliance caused it?" | H-C | `what_costs_most` | **The honest refusal.** Half-hourly data cannot identify appliances, and we say so. This is a strength — demo it deliberately. |
| 5 | "I'm struggling to pay this." | H-D | `hardship` | Detected and routed to a human. Compliance infrastructure, not a feature. |
| 6 | *(operator shows the verification log)* | — | — | N prompts, 0 fabricated figures. The 61.9% concern, answered with evidence. |
| 7 | *(same question, spoken)* | H-A | `why_bill_high` | Same pipeline, same guarantee, different channel — this is the 900 calls/week. |

## Notes for the run

- Line 4 is the one most teams would hide. Lead into it: *"here's a question we
  deliberately refuse to answer, and why that's the point."*
- Line 6 needs the rejection log visible on screen. Build the view on Day 9.
- Line 7 should be the same question as line 1 so the judge can hear the guarantee
  hold across channels.
- Say the offline property out loud: *"this is running entirely on this laptop, no
  internet, no customer data leaving the device."* That directly answers the 47.6%
  who don't trust AI with their usage data.

## Open

- [ ] Confirm the seven lines with the team before Day 2 seeding.
- [ ] Decide who drives and who narrates.
- [ ] Record the fallback video on Day 10 morning.
