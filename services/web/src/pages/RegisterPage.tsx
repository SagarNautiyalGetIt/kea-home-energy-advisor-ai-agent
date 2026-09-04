import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import OfflineModelPrompt from '../components/OfflineModelPrompt'
import { rememberOfflineOptIn } from '../lib/alerts'

type RegisterErrors = { name?: string; email?: string; password?: string; confirm?: string }

export default function RegisterPage({ onRegister }: { onRegister: () => void }) {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<RegisterErrors>({})
  const [askOffline, setAskOffline] = useState(false)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const nextErrors: RegisterErrors = {}
    if (name.trim().length < 2) nextErrors.name = 'Enter your full name.'
    if (!/^\S+@\S+\.\S+$/.test(email)) nextErrors.email = 'Enter a valid email address.'
    if (password.length < 8) nextErrors.password = 'Password must contain at least 8 characters.'
    if (confirm !== password) nextErrors.confirm = 'Both passwords must match.'
    setErrors(nextErrors)
    // The connectivity question goes here rather than before the form: asking somebody
    // about their internet quality before they have an account is a question with no
    // context. It is asked once, and declining is a complete answer — the same switch
    // lives in Settings for anyone who changes their mind.
    if (!Object.keys(nextErrors).length) setAskOffline(true)
  }

  const finishRegistration = (optIn: boolean) => {
    rememberOfflineOptIn(optIn)
    setAskOffline(false)
    onRegister()
  }

  return (
    <>
    {askOffline && <OfflineModelPrompt onDecision={finishRegistration} />}
    <main className="login-page">
      <section className="login-panel" aria-labelledby="register-title">
        <div className="login-content register-content">
          <header><h1 id="register-title">Sign up</h1></header>
          <form onSubmit={submit} noValidate>
            <label htmlFor="full-name">Full name<span>*</span></label>
            <input id="full-name" name="name" type="text" placeholder="Adela Parkson" autoComplete="name" value={name} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name?'name-error':undefined} onChange={(event)=>setName(event.target.value)} />
            {errors.name&&<small className="field-error" id="name-error">{errors.name}</small>}

            <label htmlFor="register-email">Email address<span>*</span></label>
            <input id="register-email" name="email" type="email" placeholder="name@example.com" autoComplete="email" value={email} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email?'register-email-error':undefined} onChange={(event)=>setEmail(event.target.value)} />
            {errors.email&&<small className="field-error" id="register-email-error">{errors.email}</small>}

            <label htmlFor="register-password">Password<span>*</span></label>
            <div className={`password-field ${errors.password?'field-invalid':''}`}>
              <input id="register-password" name="password" type={showPassword ? 'text' : 'password'} placeholder="Min. 8 characters" autoComplete="new-password" value={password} aria-invalid={Boolean(errors.password)} aria-describedby={errors.password?'register-password-error':undefined} onChange={(event)=>setPassword(event.target.value)} />
              <button type="button" className="eye-button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
            </div>
            {errors.password&&<small className="field-error" id="register-password-error">{errors.password}</small>}

            <label htmlFor="confirm-password">Confirm password<span>*</span></label>
            <div className={`password-field ${errors.confirm?'field-invalid':''}`}>
              <input id="confirm-password" name="confirmPassword" type={showConfirm ? 'text' : 'password'} placeholder="Re-enter your password" autoComplete="new-password" value={confirm} aria-invalid={Boolean(errors.confirm)} aria-describedby={errors.confirm?'confirm-error':undefined} onChange={(event)=>setConfirm(event.target.value)} />
              <button type="button" className="eye-button" aria-label={showConfirm ? 'Hide password' : 'Show password'} onClick={() => setShowConfirm((visible) => !visible)}>{showConfirm ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
            </div>
            {errors.confirm&&<small className="field-error" id="confirm-error">{errors.confirm}</small>}

            <button className="login-button register-button" type="submit">Create account</button>
          </form>
          <p className="auth-switch">Already have an account? <button type="button" onClick={()=>navigate('/login')}>Log in</button></p>
        </div>
        <footer>© 2026 Kea Energy. All rights reserved. Made with love by HAKAS.</footer>
      </section>
      <aside className="brand-panel" aria-label="Kea Energy"><img className="energy-mark" src="/assets/brand/kea-brand-white.svg" alt="" /><strong>KEA ENERGY</strong></aside>
    </main>
    </>
  )
}
