import { Info } from 'lucide-react'

export default function PreviewAccountModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="logout-modal preview-account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-account-title"
        aria-describedby="preview-account-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="logout-icon"><Info aria-hidden="true" /></div>
        <h2 id="preview-account-title">Preview account</h2>
        <p id="preview-account-description">
          This is a preview build, so signing up won’t create a real account. To look around, sign in with one of the demo accounts on the login page.
        </p>
        <div><button type="button" onClick={onClose}>Got it</button></div>
      </section>
    </div>
  )
}
