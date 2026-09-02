import { useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AppShell from './components/AppShell'
import LogoutModal from './components/LogoutModal'
import OnboardingModal from './components/OnboardingModal'
import ToastStack, { type ToastMessage } from './components/ToastStack'
import AssistantPage from './pages/AssistantPage'
import BillingPage from './pages/BillingPage'
import DashboardPage from './pages/DashboardPage'
import HelpPage from './pages/HelpPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import PlansPage from './pages/PlansPage'
import RegisterPage from './pages/RegisterPage'
import ProfilePage from './pages/ProfilePage'
import SettingsPage from './pages/SettingsPage'
import UsagePage from './pages/UsagePage'
import VerificationPage from './pages/VerificationPage'
import type { PageId } from './types/navigation'
import { clearSession, loadSession, saveSession, type Session } from './lib/session'

const routeFor: Record<PageId, string> = {
  dashboard: '/dashboard', usage: '/usage', billing: '/billing', assistant: '/assistant',
  plans: '/plans', profile: '/profile', help: '/help', settings: '/settings',
}

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const nextToastId = useRef(1)
  // The identity, not a boolean. Every page scopes to `session.customerId`; before
  // this, all fourteen logins fell through to households[0] and showed one customer.
  const [session, setSession] = useState<Session | null>(loadSession)
  const [showLogout, setShowLogout] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const addToast = (message: string, tone: ToastMessage['tone'] = 'success') => {
    const id = nextToastId.current++
    setToasts((current) => [...current, { id, message, tone }])
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200)
  }
  const go = (page: PageId) => navigate(routeFor[page])
  const active = (Object.entries(routeFor).find(([, path]) => location.pathname === path)?.[0] as PageId | undefined)
  const login = (next: Session) => {
    saveSession(next)
    setSession(next)
    navigate('/dashboard')
    if (localStorage.getItem('kea-onboarding-seen') !== 'true') setShowOnboarding(true)
    // The real name off the account, not a hardcoded "Adela" — that greeting was the
    // most visible symptom of the session having no identity in it.
    addToast(`Welcome back, ${next.displayName}`)
  }
  const register = () => {
    // No signup endpoint yet. Inventing a Session here would give every page a
    // customerId the API cannot resolve, so the new customer signs in instead.
    localStorage.removeItem('kea-onboarding-seen')
    navigate('/login')
    addToast('Your Kea Energy account is ready — please sign in')
  }
  const confirmLogout = () => {
    clearSession()
    setShowLogout(false)
    setSession(null)
    navigate('/login')
  }
  const closeOnboarding = () => { localStorage.setItem('kea-onboarding-seen', 'true'); setShowOnboarding(false) }

  if (!session) return <><Routes><Route path="/login" element={<LoginPage onLogin={login} onToast={addToast}/>}/><Route path="/register" element={<RegisterPage onRegister={register}/>}/><Route path="*" element={<Navigate to="/login" replace/>}/></Routes><ToastStack toasts={toasts} onDismiss={(id)=>setToasts((items)=>items.filter((item)=>item.id!==id))}/></>

  return <AppShell active={active} onNavigate={go} onLogout={() => setShowLogout(true)}>
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace/>}/>
      <Route path="/login" element={<Navigate to="/dashboard" replace/>}/>
      <Route path="/register" element={<Navigate to="/dashboard" replace/>}/>
      <Route path="/dashboard" element={<DashboardPage onNavigate={go}/>}/>
      <Route path="/usage" element={<UsagePage/>}/>
      <Route path="/billing" element={<BillingPage onToast={addToast}/>}/>
      <Route path="/assistant" element={<AssistantPage onEscalate={() => addToast('A Customer Care request has been prepared', 'info')} onToast={addToast}/>}/>
      <Route path="/plans" element={<PlansPage onToast={addToast}/>}/>
      <Route path="/profile" element={<ProfilePage onToast={addToast}/>}/>
      <Route path="/help" element={<HelpPage onToast={addToast}/>}/>
      <Route path="/settings" element={<SettingsPage onToast={addToast}/>}/>
      {/* Demo line 6. Deliberately not in the customer navigation — this is the
          operator's evidence view, reached by URL during the pitch. */}
      <Route path="/verification" element={<VerificationPage/>}/>
      <Route path="*" element={<NotFoundPage onHome={() => go('dashboard')}/>}/>
    </Routes>
    {showLogout && <LogoutModal onCancel={()=>setShowLogout(false)} onConfirm={confirmLogout}/>}
    {showOnboarding && <OnboardingModal onClose={closeOnboarding}/>}
    <ToastStack toasts={toasts} onDismiss={(id)=>setToasts((items)=>items.filter((item)=>item.id!==id))}/>
  </AppShell>
}

export default App
