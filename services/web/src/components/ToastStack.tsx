import type { ComponentType } from 'react'
import { CheckCircle2, CircleAlert, Info, X, type LucideProps } from 'lucide-react'

/** `icon` replaces the tone's own icon when a message is about one particular action, so
 *  the toast shows the icon of the control that caused it (New chat's compose icon, say). */
export type ToastMessage = { id: number; message: string; tone?: 'success' | 'info' | 'warning'; icon?: ComponentType<LucideProps> }

export default function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => {
        const Icon = toast.icon ?? (toast.tone === 'warning' ? CircleAlert : toast.tone === 'info' ? Info : CheckCircle2)
        return <div className={`toast toast-${toast.tone ?? 'success'}`} key={toast.id}><Icon aria-hidden="true"/><span>{toast.message}</span><button aria-label="Dismiss message" onClick={() => onDismiss(toast.id)}><X aria-hidden="true"/></button></div>
      })}
    </div>
  )
}
