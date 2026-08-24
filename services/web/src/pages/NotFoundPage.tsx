import { Home, SearchX } from 'lucide-react'

export default function NotFoundPage({ onHome }: { onHome: () => void }) {
  return <div className="not-found"><SearchX/><h1>Page not found</h1><p>The page you requested does not exist or has moved.</p><button onClick={onHome}><Home/>Return to dashboard</button></div>
}
