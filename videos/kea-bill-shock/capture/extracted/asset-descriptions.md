# Asset inventory

No assets were captured. The product is a local-only application with no public URL —
Postgres in Docker plus a native Ollama runtime on the demo laptop.

All on-screen product surfaces are **reconstructed in HTML** from the real source:

| Surface | Source of truth |
|---|---|
| Usage chart, July, household H-A | `services/web/src/components/UsageGraph.tsx` |
| Assistant answer + Sparky ring | `services/web/src/pages/AssistantPage.tsx`, `components/sparky/` |
| Verification log headline | `services/web/src/pages/VerificationPage.tsx` |
| Figures (`$2.64`, `$290`) | `services/api/app/analytics/engine.py`, pinned in `tests/test_analytics_july.py` |
| Violet accent | `--shadow-button` in `services/web/src/index.css` |
