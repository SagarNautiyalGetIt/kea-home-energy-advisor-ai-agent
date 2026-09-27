import { CloudOff, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import Modal from './Modal'
import { formatMb, getOfflineModels, type OfflineModelOption } from '../lib/alerts'

/** Records interest in future offline answers; no model is downloaded in this build. */

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
            Save my interest
          </button>
        </>
      }
    >
      <div className="offline-prompt">
        <CloudOff aria-hidden="true" className="offline-prompt-mark" />
        <p>
          Interested in an offline version of Sparky? This build records your preference,
          but does not download a model or answer questions without a connection yet.
        </p>
        <ul className="offline-prompt-points">
          <li>
            <Wifi aria-hidden="true" />
            <span>
              {smallest
                ? `A proposed on-device model is about ${formatMb(smallest.download_mb)}. No download starts in this build.`
                : 'No download starts in this build.'}
            </span>
          </li>
          <li>
            <span aria-hidden="true">•</span>
            <span>
              The planned offline version will use dated, precomputed facts rather than
              inventing readings while disconnected.
            </span>
          </li>
          <li>
            <span aria-hidden="true">•</span>
            <span>
              Until that version ships, Sparky needs a connection to answer.
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
