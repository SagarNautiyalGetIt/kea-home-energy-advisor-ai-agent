# goldens/ — the golden set

The measurement everything else is allowed to be tuned against. Per the standing rule in
[`../README.md`](../README.md):

> **Don't tune prompts before the golden set exists.** Tuning without a measurement is
> vibes.

It exists now. Tune away.

## What is in here

`golden_set.json` — 36 routed prompts and 14 verified drafts across all five demo
households and all eight intents. Executed by
[`../../services/api/tests/test_golden_set.py`](../../services/api/tests/test_golden_set.py)
on every push and pull request.

```bash
make ml-golden     # run the set and print the headline
```

## What it actually proves

**No model is involved, and no database is needed.** That is a consequence of ADR-0002:
Python decides and the model only narrates, so layers 0, 1 and 3 — the three that carry
the trust claim — run with nothing installed. A golden set that needed Ollama would run
on one laptop; this one runs in CI.

Scoring a *real model* against these cases is a different job: that is the Day 6 bake-off
(KEA-47), it belongs in [`../evals/`](../evals/), and it measures layer 2. This set
measures everything around layer 2. The distinction matters when quoting a number — this
file supports *"layer 3 catches fabricated figures"*, not *"our model never fabricates."*

## The four sections

| Section | Asserts |
|---|---|
| `routing` | A question reaches the right intent, gets the right facts, and carries the right caveats |
| `verification_must_reject` | An invented figure is caught. **This is the product claim.** |
| `verification_must_pass` | A legitimate answer is *not* caught |
| `verification_known_gap` | A documented hole behaves as documented, and breaks loudly when fixed |

`verification_must_pass` is the section people want to skip. Don't. A verifier that
rejected every draft would report a perfect "0 fabricated figures" while turning every
answer into the template fallback — and the headline would still be technically true.
Both directions, or the number means nothing.

## Adding a case

Cases are data, not code. Add to the relevant array in `golden_set.json`:

```json
{
  "id": "R-0xx",
  "question": "what a customer would actually type",
  "customer_id": "H-JUL",
  "expect_intent": "why_bill_high",
  "expect_facts": ["sustained_overshoot"],
  "note": "why this case is worth a reviewer's attention"
}
```

Optional keys: `expect_escalation`, `expect_empty_bundle`, `expect_caveat_substring`,
`demo_line`.

For a verification case, give `intent`, `draft`, and — when it must be rejected —
`must_reject_tokens` plus a `why` explaining what makes the figure invented. The `why`
is printed in the failure message, so write it for whoever is debugging at 11pm.

Ids must be unique; a test enforces it. Two further tests enforce that **every intent**
and **every demo household** has at least one case, so adding an intent without golden
coverage fails CI rather than passing silently.

## Grow it from failures, not from taste

The set already paid for itself on the first run. It caught two router bugs:

- **R-020** — *"Wasn't that just the cold snap?"*, which is **demo line 2**, routed to
  `out_of_scope`. The router had no weather phrasing at all, so the scripted question
  about the cold snap could not reach the weather-attribution path. This would have been
  found on stage.
- **R-052** — *"how do I compare to last winter"* routed to `out_of_scope`, because the
  rule matched only the exact phrase `compared to last winter`.

Both are fixed in `app/routing/intents.py`, with the case id in the comment so the next
person to touch those regexes knows what they are protecting.

That is the intended loop: a demo question or a bake-off failure becomes a case here
first, then the fix goes in. A fix without a case is a fix that regresses.

## Known gap, deliberately open

Worded quantities — "doubled", "twice", "a third" — carry no numeric token, so layer 3
cannot see them. `V-201` pins the current behaviour so closing the gap breaks the test
loudly instead of leaving a stale comment in `number_checker.py`.

## Related

- [`../../docs/adr/0002-narrate-only-architecture.md`](../../docs/adr/0002-narrate-only-architecture.md) — why layers 0/1/3 are model-free
- [`../../services/api/app/verification/number_checker.py`](../../services/api/app/verification/number_checker.py) — layer 3 itself
- [`../../docs/sprints/sprint-2/demo-script.md`](../../docs/sprints/sprint-2/demo-script.md) — the lines the `demo_line` keys point at
- [`../evals/`](../evals/) — KEA-47, scoring a real model against these cases
