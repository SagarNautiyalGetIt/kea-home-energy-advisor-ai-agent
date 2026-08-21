import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

type ModalProps = {
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  wide?: boolean
}

export default function Modal({ title, children, onClose, footer, wide = false }: ModalProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`app-modal ${wide ? 'app-modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><h2 id="modal-title">{title}</h2><button type="button" aria-label="Close" onClick={onClose}><X aria-hidden="true" /></button></header>
        <div className="app-modal-content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </section>
    </div>
  )
}
