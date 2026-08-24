import { CircleAlert, Inbox, LoaderCircle, RotateCcw } from 'lucide-react'

type FeedbackStateProps = {
  state: 'loading' | 'empty' | 'error'
  title?: string
  message?: string
  onRetry?: () => void
}

export default function FeedbackState({ state, title, message, onRetry }: FeedbackStateProps) {
  const Icon = state === 'loading' ? LoaderCircle : state === 'empty' ? Inbox : CircleAlert
  return <div className={`feedback-state feedback-${state}`} role={state === 'error' ? 'alert' : 'status'}><Icon aria-hidden="true"/><h3>{title ?? (state === 'loading' ? 'Loading' : state === 'empty' ? 'Nothing here yet' : 'Something went wrong')}</h3>{message && <p>{message}</p>}{state === 'error' && onRetry && <button onClick={onRetry}><RotateCcw aria-hidden="true"/>Retry</button>}</div>
}
