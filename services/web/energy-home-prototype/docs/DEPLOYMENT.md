# Deployment

## Build

```bash
npm ci
npm run check
```

The production application is emitted to `dist/`.

## Static hosting

Serve `dist/` from any static host that supports an SPA entry document. No server-side environment variables are required.

Recommended production properties:

- HTTPS enabled;
- immutable caching for hashed files under `dist/assets/`;
- short caching for `index.html`;
- a restrictive content security policy tested against Open-Meteo requests and local assets;
- compression enabled for JavaScript, CSS, SVG, and font files;
- a fallback from unknown routes to `index.html` if routing is later introduced.

## Smoke test

After deployment, verify:

1. the page loads without console errors;
2. the house asset and Geist fonts render;
3. each preset scenario changes the sky and flow state;
4. live weather can fetch a town and current conditions;
5. settings persist after a reload;
6. narrow and wide viewports remain usable;
7. the footer still labels energy values as simulated.

## Rollback

This is a static site. Roll back by redeploying the last known-good build artifact or commit. Roll back immediately if the app fails to load, the simulation is presented as telemetry, location behavior leaks precise private data, or external requests begin sending unexpected information.
