import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end functional tests for the Kea Energy customer website.
 *
 * Read [`CONVENTIONS.md`](./CONVENTIONS.md) before adding a test. Every rule in it is
 * free to follow while writing and expensive to retrofit across a suite.
 *
 * ## What this suite is, and what it deliberately is not
 *
 * System-level functional tests: a real browser drives the real React app, which calls
 * the real API, which reads real data. Nothing is mocked.
 *
 * Whether `analytics/engine.py` computes the right number is already answered by
 * `services/api/tests/` — fifteen files of it, including the golden set — and this suite
 * does not repeat that work. Duplicating a covered assertion at a slower level buys
 * nothing and costs a maintainer two places to update.
 *
 * What it covers is the part pytest cannot see: that a correctly computed number
 * survives serialisation, HTTP, the generated TypeScript types and React rendering, and
 * arrives in front of a customer. Same test *type* (functional), different test *level*.
 *
 * ## Preconditions
 *
 * The stack must already be up, and **which demo accounts resolve depends on how the API
 * was started** — see [`../README.md`](../README.md). That is not a footnote: nine of the
 * fourteen advertised sign-ins 404 against a fixtures-only backend.
 */
export default defineConfig({
  testDir: './tests',

  /* Files run alongside each other. Tests must therefore not depend on one another or on
   * execution order — see CONVENTIONS.md §4. */
  fullyParallel: true,

  /* `test.only` is a debugging aid that must never reach main: it silently reduces the
   * suite to a single test while CI still reports green. */
  forbidOnly: !!process.env.CI,

  /* Retries hide flakiness, so they are off locally — where a flake is a bug you should
   * be fixing — and on in CI, where a shared runner adds timing noise you cannot. */
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  /* `list` for live progress in the terminal; `html` is the artefact — the report you
   * open afterwards and the one CI will upload. `open: 'never'` because a browser
   * launching itself after every local run stops being helpful within the hour. */
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    /* Every navigation is relative to this, so a test reads `page.goto('/usage')` and no
     * file hardcodes a port. Overridable so the same suite can be pointed at a deployed
     * environment without editing a line of test code.
     *
     * Vite proxies `/api` to the backend on :8000, so this one origin also reaches the
     * API through Playwright's `request` fixture — no second base URL, no CORS. */
    baseURL: process.env.KEA_BASE_URL ?? 'http://localhost:5173',

    /* Evidence for a failure, and nothing for a pass. A trace on every run would be
     * gigabytes of artefacts nobody opens; a trace on the retry of a failure is the one
     * you actually want, with the full DOM, network log and timeline. */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    /* Signs in once per account and writes fourteen storageState files. Every other
     * project depends on it, so a spec can `test.use({ storageState })` and be certain the
     * file is there — no ordering by convention, no "run setup first" in a README. */
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },

    /* Firefox and WebKit are deliberately NOT enabled.
     *
     * Running every functional test three times triples the wall clock to re-verify
     * business logic that cannot differ between browsers. Cross-browser coverage is a
     * real concern but a narrow one — layout and web-platform behaviour — so it belongs
     * on a tagged subset rather than the whole suite. Both browsers are already
     * installed; CONVENTIONS.md §6 has the tag and how to turn them on. */
  ],

  /* A health gate, not a launcher.
   *
   * With `reuseExistingServer` on, a stack you already have running is checked and
   * reused — this starts nothing, which is the normal local case. Its real job is the
   * other one: when a service is down you get a single clear "server did not respond"
   * instead of thirty tests failing on selectors that were never the problem.
   *
   * Postgres is not started here. Docker is a documented precondition, not something a
   * test runner should be booting on your behalf. */
  webServer: [
    {
      command: '.venv/bin/uvicorn app.main:app --port 8000',
      cwd: '../../services/api',
      url: 'http://localhost:8000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      /* Set explicitly rather than left to the root `.env`. The login page is built from
       * this flag, and `KEA_DEMO_LOGINS` is off by default — a suite that quietly tested
       * a 503 would be worse than one that refused to start. Playwright merges this over
       * `process.env`, so nothing else in the environment is lost. */
      env: { KEA_DEMO_LOGINS: '1' },
    },
    {
      command: 'npm run dev',
      cwd: '../../services/web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
