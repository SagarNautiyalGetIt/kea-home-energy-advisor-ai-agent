import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'

export type ToastMessage = { id: number; message: string; tone?: 'success' | 'info' | 'warning' }

export default function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => {
        const Icon = toast.tone === 'warning' ? CircleAlert : toast.tone === 'info' ? Info : CheckCircle2
        return <div className={`toast toast-${toast.tone ?? 'success'}`} key={toast.id}><Icon aria-hidden="true"/><span>{toast.message}</span><button aria-label="Dismiss message" onClick={() => onDismiss(toast.id)}><X aria-hidden="true"/></button></div>
      })}
    </div>
  )
}
