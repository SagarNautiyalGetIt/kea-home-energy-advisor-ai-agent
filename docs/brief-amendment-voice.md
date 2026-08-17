# Draft amendment — Research Brief §5, the voice instruction

**Status: DRAFT for the team. Not applied.** The brief is the team's document; whoever
owns it makes this edit.

## The problem

Brief v2 §5 currently ends:

> And one thing to stop: voice and speech-recognition design. We have no evidence anybody
> wants it, and two of nine responses is not a mandate.

Sprint 2 is building a voice channel. As written, our own primary source instructs against
the thing we are demoing — and a judge who reads the brief will see it.

## Why the instruction is right about one thing and silent about another

The §5 line rests on the interaction-preference question: 9 of 21 answered, voice call 22.2%
(two people). That is evidence about **voice as an app feature** — a customer choosing how
to interact with an energy app they have already opened.

It says nothing about **voice as call deflection**, because the survey never sampled callers.
§6 states this outright:

> …mostly do not call — they open the app or shrug. So we can cite the brief for deflection,
> and we must not cite our survey. If anything, app users are already deflected and the
> callers are a group we did not reach.

The 900+ bill-query calls a week, 12–15 minutes each, ≈200 agent-hours come from the **Kea
scenario brief**, not from us. That is the evidence base for the voice channel, and it is
stronger than anything our survey could have provided.

## Proposed replacement text

> And one thing to be precise about: voice.
>
> Two different claims hide under that word, and only one of them is unfunded.
>
> **Voice as an app feature** — someone opening our app and choosing to talk to it rather
> than look at a chart — has no support. Nine people answered the interaction-preference
> question and two picked voice. Combined with the 61.9% who already use their provider's
> app to check usage, the direction for the app itself is visual, with SMS for alerts. We
> should not design a voice-first app experience on this evidence.
>
> **Voice as call deflection** — answering the phone calls that already exist — is a
> different proposition with a different source. The Kea scenario brief gives us 900+
> bill-query calls a week at 12–15 minutes each, ≈200 agent-hours. That is the workload the
> agent is built to absorb, and it arrives by phone whether we build for it or not.
>
> Our survey cannot speak to the second claim, and we should not pretend otherwise: as §6
> notes, our respondents are not the callers. We are citing the scenario brief for the
> voice channel, and our survey for the app. Keeping those separate is the honest position,
> and it is also the stronger one.

## Why it is worth the edit

Our defining discipline is that every claim traces to a source. An unamended §5 means either
the deck contradicts the brief, or someone has to explain the discrepancy live. Making the
distinction ourselves — before we are asked — is the same move as naming the added-obligation
risk in §3, and it lands the same way.

## Related

- ADR-0003 (`docs/adr/0003-voice-transport-skin.md`) — the technical consequence: voice reuses
  the identical pipeline, so it cannot say anything chat wouldn't.
