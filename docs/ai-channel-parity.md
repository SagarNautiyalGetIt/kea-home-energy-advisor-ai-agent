# Website and mobile AI parity

Both signed-in account assistants use `/api/chat/stream`, the same configured backend
provider, account tools and prompt. The website does not use an older backend model.
Different accounts, prior turns, solar calculation context, or an enabled on-phone
model for general energy education can produce different responses. Generated wording
can also vary; parity means the same account evidence and capabilities.

The HTTP chat routes now accept a bounded `history` of user/assistant text: at most
12 messages with 4,000 characters each. Both clients send their last six completed
service exchanges. Greetings, errors, partial answers and on-phone replies are excluded.
History helps resolve follow-ups even when persistence is disabled. It is not verified
account evidence or permission to act; the backend loads a fresh scoped account summary
for every turn and retains tool confirmation safeguards. Existing clients may omit it.

The website validates streamed completion and evidence metadata, handles split/CRLF
frames and stops after one completion or error. A connection ending without completion
is an error rather than a partial answer presented as finished. Tier 3 responses are
labelled as Customer Care support, and provenance refers to the actual account sources
rather than calling invoice or plan data meter readings.

## Compare both platforms

Use the same account, API deployment and initial conversation on each platform. For the
local synthetic demo, use July Household (`july@kea.example`, password `julyhouse24`),
start a new chat and ask **Why is my power bill so high?** Then ask
**How can I reduce that?** These are ordinary AI questions, with no scripted answers
or presentation interception. The trailing apostrophe reported by the user is covered
in the HTTP parity regression too.

The website retains its current GSAP/Sparky animations and paragraph rendering. Mobile
retains its native streaming, mascot reactions and native answer formatting. An uploaded
bill's extracted request text remains in active memory and is omitted from saved browser
threads; saved display text stays available after navigation.

## Verification and cloud setup

Run `npm --prefix services/web run test:chat`, web lint/build, mobile typecheck/lint/tests,
and `PYTHONPATH=services/api pytest services/api/tests` locally. The history tests use
the real HTTP routes, scoped summary and a scripted test provider, not a live model.
The repository's temporary CI pause remains in place; its `check` status only announces
that validation is paused.

The cloud engineer should configure the existing AWS Bedrock provider as documented in
`aws-client-readiness.md` and point both clients at that same API. Confirm `/api/health`
reports `provider=bedrock` and `model_ready=true`, then repeat the same-account questions.
Without configured credentials, a bill question reports provider unavailability; a
hardship disclosure can still receive the Python-generated support handover. Offline
tests and exports do not establish live Bedrock answer quality or physical-phone results.
