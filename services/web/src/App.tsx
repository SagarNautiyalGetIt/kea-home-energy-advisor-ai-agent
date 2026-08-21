import { useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import AppShell from './components/AppShell'
import LogoutModal from './components/LogoutModal'
import OnboardingModal from './components/OnboardingModal'
import ToastStack, { type ToastMessage } from './components/ToastStack'
import HelpPage from './pages/HelpPage'
import LoginPage from './pages/LoginPage'
import PlansPage from './pages/PlansPage'
import ProfilePage from './pages/ProfilePage'
import SettingsPage from './pages/SettingsPage'
import type { PageId } from './types/navigation'

const routeFor: Record<PageId, string> = {
  plans: '/plans', profile: '/profile', help: '/help', settings: '/settings',
}

function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const nextToastId = useRef(1)
  const [loggedIn, setLoggedIn] = useState(localStorage.getItem('kea-demo-session') === 'true')
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
  const login = () => {
    localStorage.setItem('kea-demo-session', 'true')
    setLoggedIn(true)
    navigate('/plans')
    if (localStorage.getItem('kea-onboarding-seen') !== 'true') setShowOnboarding(true)
    addToast('Welcome back, Adela')
  }
  const confirmLogout = () => {
    localStorage.removeItem('kea-demo-session')
    setShowLogout(false)
    setLoggedIn(false)
    navigate('/login')
  }
  const closeOnboarding = () => { localStorage.setItem('kea-onboarding-seen', 'true'); setShowOnboarding(false) }

  if (!loggedIn) return <><Routes><Route path="/login" element={<LoginPage onLogin={login} onToast={addToast}/>}/><Route path="*" element={<Navigate to="/login" replace/>}/></Routes><ToastStack toasts={toasts} onDismiss={(id)=>setToasts((items)=>items.filter((item)=>item.id!==id))}/></>

  return <AppShell active={active} onNavigate={go} onLogout={() => setShowLogout(true)}>
    <Routes>
      <Route path="/" element={<Navigate to="/plans" replace/>}/>
      <Route path="/login" element={<Navigate to="/plans" replace/>}/>
      <Route path="/plans" element={<PlansPage onToast={addToast}/>}/>
      <Route path="/profile" element={<ProfilePage onToast={addToast}/>}/>
      <Route path="/help" element={<HelpPage onToast={addToast}/>}/>
      <Route path="/settings" element={<SettingsPage onToast={addToast}/>}/>
      <Route path="*" element={<Navigate to="/plans" replace/>}/>
    </Routes>
    {showLogout && <LogoutModal onCancel={()=>setShowLogout(false)} onConfirm={confirmLogout}/>}
    {showOnboarding && <OnboardingModal onClose={closeOnboarding}/>}
    <ToastStack toasts={toasts} onDismiss={(id)=>setToasts((items)=>items.filter((item)=>item.id!==id))}/>
  </AppShell>
}

export default App
