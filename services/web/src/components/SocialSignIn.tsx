type SocialSignInProps = {
  onUnavailable: (provider: 'Google' | 'Apple') => void
}

const GoogleMark = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path fill="#ea4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285f4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#fbbc05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.55 10.78l7.98-6.19z"/>
    <path fill="#34a853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
)

const AppleMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M16.365 1.43c0 1.14-.42 2.2-1.25 3.03-.98.99-2.05 1.56-3.2 1.47-.05-1.12.44-2.24 1.24-3.04.85-.86 2.16-1.44 3.21-1.46zM20.9 17.13c-.53 1.23-.78 1.78-1.46 2.87-.95 1.52-2.29 3.42-3.95 3.43-1.47.02-1.85-.96-3.85-.95-2 .01-2.42.97-3.89.95-1.66-.02-2.93-1.73-3.88-3.25-2.66-4.25-2.94-9.24-1.3-11.89 1.17-1.88 3.01-2.98 4.74-2.98 1.76 0 2.87.97 4.33.97 1.41 0 2.27-.97 4.31-.97 1.54 0 3.17.84 4.33 2.29-3.81 2.09-3.19 7.53.62 9.53z"/>
  </svg>
)

export default function SocialSignIn({ onUnavailable }: SocialSignInProps) {
  return (
    <>
      <p className="auth-divider"><span>or continue with</span></p>
      <div className="social-row">
        <button type="button" onClick={() => onUnavailable('Google')}><GoogleMark/>Google</button>
        <button type="button" onClick={() => onUnavailable('Apple')}><AppleMark/>Apple</button>
      </div>
    </>
  )
}
