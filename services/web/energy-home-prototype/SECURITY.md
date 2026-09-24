# Security policy

## Supported versions

This is a prototype rather than a hosted service. Security fixes are applied to the latest `main` branch.

| Version         | Supported |
| --------------- | --------- |
| `main`          | Yes       |
| Older snapshots | No        |

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Use GitHub's **Report a vulnerability** flow in the repository's Security tab so details remain private until a fix is available.

Include the affected file or behavior, reproduction steps, impact, and any suggested mitigation. Remove secrets, tokens, private coordinates, and unrelated personal data from the report.

## Security model

- The application has no backend, account system, authentication layer, or server-side data store.
- Location and weather requests go directly from the browser to Open-Meteo endpoints.
- Preferences are stored in browser `localStorage`.
- No secret is required to run the prototype.
- Dependency changes are reviewed through `package-lock.json`, `npm audit`, tests, and the production build.

See [Data and privacy](docs/DATA_AND_PRIVACY.md) for the full data-flow boundary.
