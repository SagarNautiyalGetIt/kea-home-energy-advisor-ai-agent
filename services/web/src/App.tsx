import { useEffect, useRef, useState } from "react";

import {
  getHealth,
  getHouseholds,
  streamChat,
  type DoneEvent,
  type Health,
  type HouseholdSummary,
} from "./lib/client";

/**
 * A deliberately plain integration harness, not the pitch UI.
 *
 * It exists to prove the wiring works end to end — health, households, and a
 * streamed answer with its verification result. Build the real interface around
 * these calls; do not build it inside this file.
 */
export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [households, setHouseholds] = useState<HouseholdSummary[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [message, setMessage] = useState("Why is my bill so high?");
  const [answer, setAnswer] = useState("");
  const [report, setReport] = useState<DoneEvent | null>(null);
  const [escalate, setEscalate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setError("backend unreachable — is `make api-dev` running?"));
    getHouseholds()
      .then((hs) => {
        setHouseholds(hs);
        if (hs[0]) setCustomerId(hs[0].customer_id);
      })
      .catch(() => undefined);
  }, []);

  // An in-flight stream outlives the component unless it is cancelled.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function ask() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setAnswer("");
    setReport(null);
    setEscalate(false);
    setError(null);

    try {
      await streamChat(
        { customer_id: customerId, message },
        {
          onMeta: (m) => setEscalate(m.escalate),
          onToken: (t) => setAnswer((prev) => prev + t.text),
          onDone: setReport,
        },
        controller.signal,
      );
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold text-kea-900">Kea Energy — Home Energy Advisor</h1>
        <p className="text-sm text-gray-600">
          {health
            ? `${health.provider} · ${health.model} · ${health.model_ready ? "warm" : "cold"}`
            : "checking backend…"}
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <label className="block text-sm font-medium">
          Household
          <select
            className="mt-1 block w-full rounded border border-gray-300 p-2"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            {households.map((h) => (
              <option key={h.customer_id} value={h.customer_id}>
                {h.label} — {h.total_kwh} kWh
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm font-medium">
          Question
          <input
            className="mt-1 block w-full rounded border border-gray-300 p-2"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>

        <button
          type="button"
          onClick={ask}
          disabled={busy || !customerId}
          className="rounded bg-kea-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>

      {answer && <p className="rounded bg-kea-50 p-4 leading-relaxed">{answer}</p>}

      {/* Under the Consumer Care Obligations this path is closer to a legal duty
          than a feature. It must be visible whenever the backend sets it. */}
      {escalate && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          This conversation should be handed to a person.
        </p>
      )}

      {/* `passed` alone is the wrong test — it answers "did the MODEL's draft survive
          the number-checker", and stays false when we serve a deterministic template
          built from already-verified facts. Rendering "failed" there would undermine
          the exact claim the product is built on. See docs/api-standards.md B4. */}
      {report && (
        <p className="text-sm text-gray-600">
          {report.passed
            ? "Every figure verified against computed facts."
            : report.fell_back_to_template
              ? "Figures computed directly — the model was unavailable, so this is a plain summary."
              : "⚠ This answer could not be verified. Do not rely on these figures."}
        </p>
      )}
    </main>
  );
}
