"""Asking the customer, when the data cannot answer on its own.

    detect      residuals              ->  a dated gap nobody can explain    (pure)
    questions   the gap + what we know ->  one question worth asking         (pure)
    apply       the answer             ->  household context, re-attributed  (pure)

## The decision this package takes away from the model

"Ask a question when you are unsure" reads like a job for the model. It is not. A model
asked to judge its own confidence does it fluently and wrongly — and worse, it would be
*choosing what to ask about somebody's home*, which is a decision made by the one
component that is not allowed to make decisions about the customer's data.

So the trigger is computed. Layer 1 already knows what it cannot explain: whether the
weather regression was usable, how much of the overshoot is left unattributed, and whether
the everyday floor stepped up on a particular day. A question is asked only when there is
a **quantified gap** and a hypothesis that would close it, and the question text is a
Python constant. The model delivers it, unchanged.

## Answers are typed, never free text

An answer is yes / no / not sure, plus at most a date and a count. It becomes a
`HouseholdContext` field, and that field changes what layer 1 computes. Taking free text
back and pasting it into the prompt would put uncomputed numbers into the model's context —
*"probably 400 kWh"* — which is the exact failure the `FactBundle` exists to prevent.

## Three rules worth knowing before reading the code

**A question that cannot change the answer is never asked.** Each gap names the dollar
amount it would re-attribute, and no gap means no question. An assistant that always finds
something to ask is doing an intake form.

**A denial is a fact.** "No, nothing new" is what makes the occupancy question worth
asking next. Storing it as "unanswered" would ask the same thing again next month.

**Never during hardship.** A household that has told us they are struggling gets a person,
not a questionnaire — the same rule the alert policy applies, for the same reason.
"""
