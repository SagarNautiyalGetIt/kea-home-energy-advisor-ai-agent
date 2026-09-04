import { CloudOff, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import Modal from './Modal'
import { formatMb, getOfflineModels, type OfflineModelOption } from '../lib/alerts'

/**
 * Asked once, at sign-up: does this customer lose their connection often enough to want
 * an assistant that works without one?
 *
 * ## Why it is a question and not a default
 *
 * The model is several hundred megabytes. Pushing that to every phone would spend a
 * rural customer's metered data on a feature most people never need, and spend it before
 * they have decided the app is worth keeping. So nothing is downloaded unless somebody
 * says yes, and the answer is recorded as a preference the server can read — see
 * `AlertPreferences.offline_model_opt_in`.
 *
 * ## Three things this copy has to do
 *
 * * **Quote the real size.** Fetched from `/api/offline/models` rather than hard-coded,
 *   so the number agrees with what will actually be downloaded. Someone agreeing to
 *   "about 530 MB" and receiving 1.8 GB on a rural connection is a cost we imposed on
 *   them.
 * * **Say when it downloads.** "Over wifi only, later" is the difference between an
 *   offer and an ambush.
 * * **Not oversell it.** An on-device model answers from figures already calculated and
 *   stored on the phone. It cannot fetch this morning's reading, and it will say so. A
 *   customer who expects live data offline will conclude the feature is broken.
 *
 * Declining is not a dead end — the same switch is in Settings, which is where somebody
 * who moves house or changes provider will look for it.
 */

type Props = {
  onDecision: (optIn: boolean) => void
}

export default function OfflineModelPrompt({ onDecision }: Props) {
  const [models, setModels] = useState<OfflineModelOption[]>([])

  useEffect(() => {
    let live = true
    getOfflineModels()
      .then((options) => live && setModels(options))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  // Smallest first — the recommended option, and the one whose size sets the customer's
  // expectation. Falling back to no figure at all rather than a placeholder: an invented
  // download size is a fabricated number, and this product does not ship those.
  const smallest = models.length ? models.reduce((a, b) => (a.download_mb <= b.download_mb ? a : b)) : null

  return (
    <Modal
      title="Do you often lose your connection?"
      onClose={() => onDecision(false)}
      footer={
        <>
          <button type="button" className="secondary-action" onClick={() => onDecision(false)}>
            No thanks
          </button>
          <button type="button" className="primary-action" onClick={() => onDecision(true)}>
            Yes, set that up
          </button>
        </>
      }
    >
      <div className="offline-prompt">
        <CloudOff aria-hidden="true" className="offline-prompt-mark" />
        <p>
          If your internet drops out — a rural line, a storm, a patchy signal — Sparky can
          keep answering questions about your power use by keeping a small assistant on
          this device.
        </p>
        <ul className="offline-prompt-points">
          <li>
            <Wifi aria-hidden="true" />
            <span>
              {smallest
                ? `About ${formatMb(smallest.download_mb)}, downloaded over wifi only — never on mobile data.`
                : 'Downloaded over wifi only — never on mobile data.'}
            </span>
          </li>
          <li>
            <span aria-hidden="true">•</span>
            <span>
              It answers from figures already worked out and saved on your phone, and it
              tells you the date they are from.
            </span>
          </li>
          <li>
            <span aria-hidden="true">•</span>
            <span>
              It cannot fetch today's reading while you are offline, and it will say so
              rather than guess.
            </span>
          </li>
        </ul>
        <small>
          You can turn this on or off at any time in Settings. Most people never need it.
        </small>
      </div>
    </Modal>
  )
}
