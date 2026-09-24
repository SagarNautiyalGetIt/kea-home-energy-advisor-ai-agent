# Contributing

Thanks for taking an interest in Kea Energy Home.

## Contribution model

This prototype is part of the Kea Energy web project. Bug reports, reproducible test cases, accessibility findings, and design feedback are welcome. Follow the parent repository's contribution process when proposing changes.

## Reporting a bug

Include:

- browser and operating system;
- Node.js and npm versions for build failures;
- steps to reproduce;
- expected and actual behavior;
- screenshots or console output with secrets and precise home locations removed.

Use the parent repository's bug-report process. For security-sensitive findings, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Local verification

```bash
npm ci
npm run check
```

Changes should preserve these invariants:

- energy dispatch conserves power;
- battery capacity and reserve limits are never violated;
- missing or failed network data never becomes pretend live weather;
- simulated energy values are always described as simulated;
- solar, battery, and grid flow colors retain their source semantics;
- no API keys, secrets, household addresses, or precise private coordinates are committed.

## Style

- Keep TypeScript strict and avoid unsafe casts.
- Prefer small, testable functions in `src/lib/`.
- Use accessible native controls and visible focus states.
- Keep build output and dependencies out of version control.
- Update documentation when behavior or data boundaries change.

By submitting material, you agree that it may be distributed under the project's MIT License.
