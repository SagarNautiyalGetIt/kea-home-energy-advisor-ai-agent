"""Proactive contact — the half of the product that does not wait to be asked.

The bill-shock warning has to reach the customer *before* the bill does, which is why
it has its own endpoint rather than living in the chat pipeline. This package is what
happens after that endpoint decides something is wrong.

    preferences       what the customer told us about when to interrupt them   (pure)
    policy.decide()   how bad is it -> tier 1/2/3, and which channels          (pure)
    render.*_for()    the message, per channel, composed from verified figures (pure)
    channels.send()   delivery: file sink, SMTP, Resend, Textbelt, Twilio      (I/O)
    store             read and write the customer's thresholds                 (I/O)
    service.dispatch  ties them together and writes app.alert + deliveries     (I/O)

The first three are pure and testable without a database, a model or a mail server. That
split is deliberate: the tier decides whether somebody's phone rings, and that decision
has to be checkable against a table of settings rather than by sending real messages.

The customer sets the percentages; the confidence floors that go with them are
engineering policy and are not exposed. See `preferences.py` for why that line is drawn
where it is.

## No re-exports here, on purpose

This file deliberately imports nothing. A convenience `from app.alerts import decide` cost
a full afternoon: importing *any* module in this package ran `__init__`, which imported
`service`, which imported `render`, which imported `app.analytics.billshock` — and
`billshock` imports `app.alerts.preferences` to read the confidence floors. That is a
cycle, and it only failed for import orders nobody happened to use. The test suite passed
throughout; the scheduled job (`app.jobs.evaluate_bill_shock`) was the first caller to hit
it, and in a Lambda that is a cold-start crash rather than a test failure.

Import the module you want — `from app.alerts.policy import decide`. Four extra characters,
and a package whose import graph is a DAG. `tests/test_import_graph.py` pins it.
"""
