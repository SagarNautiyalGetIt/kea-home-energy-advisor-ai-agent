import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bell, BriefcaseBusiness, ChartNoAxesColumnIncreasing, CheckCheck, CircleDollarSign, CircleHelp, House, Menu, MessagesSquare, Moon, Search, Settings, SquareUserRound, Sun, X } from 'lucide-react'
import BrandMark from './BrandMark'
import type { PageId } from '../types/navigation'

const nav: Array<{ id: PageId; label: string; icon: typeof House; keywords: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: House, keywords: 'home overview cost projection' },
  { id: 'usage', label: 'Usage', icon: ChartNoAxesColumnIncreasing, keywords: 'graph energy kwh electricity' },
  { id: 'billing', label: 'Billing', icon: CircleDollarSign, keywords: 'bill invoice payment history' },
  { id: 'assistant', label: 'AI Assistant', icon: MessagesSquare, keywords: 'chat question help consumer care' },
  { id: 'plans', label: 'Plans', icon: BriefcaseBusiness, keywords: 'pricing compare tariff' },
  { id: 'profile', label: 'Profile', icon: SquareUserRound, keywords: 'customer account details' },
]

const utilityPages: Array<{ id: PageId; label: string; icon: typeof House; keywords: string }> = [
  { id: 'help', label: 'Help & Support', icon: CircleHelp, keywords: 'faq contact outage support' },
  { id: 'settings', label: 'Settings', icon: Settings, keywords: 'theme alerts privacy preferences' },
]

type AppShellProps = {
  active?: PageId
  onNavigate: (page: PageId) => void
  onLogout: () => void
  children: ReactNode
}

export default function AppShell({ active, onNavigate, onLogout, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openPanel, setOpenPanel] = useState<'search' | 'notifications' | 'profile' | null>(null)
  const topbarRef = useRef<HTMLElement>(null)
  const [query, setQuery] = useState('')
  const [theme, setTheme] = useState(localStorage.getItem('kea-theme') ?? 'light')
  const [notifications, setNotifications] = useState([
    { id: 1, title: 'High bill warning', detail: 'Projected bill is 29% above your usual range.', unread: true },
    { id: 2, title: 'Payment reminder', detail: 'Your current invoice is due on 1 Sep 2026.', unread: true },
    { id: 3, title: 'Usage update', detail: 'New smart-meter readings are available.', unread: false },
  ])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.reducedMotion = localStorage.getItem('kea-reduced-motion') === 'true' ? 'true' : 'false'
    const syncTheme = () => setTheme(localStorage.getItem('kea-theme') ?? 'light')
    window.addEventListener('kea-theme-change', syncTheme)
    return () => window.removeEventListener('kea-theme-change', syncTheme)
  }, [theme])

  useEffect(() => {
    const closePanels = (event: PointerEvent) => {
      if (openPanel && !topbarRef.current?.contains(event.target as Node)) setOpenPanel(null)
    }
    document.addEventListener('pointerdown', closePanels)
    return () => document.removeEventListener('pointerdown', closePanels)
  }, [openPanel])

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return [...nav, ...utilityPages]
    return [...nav, ...utilityPages].filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(term))
  }, [query])
  const unread = notifications.filter((item) => item.unread).length
  const go = (page: PageId) => { onNavigate(page); setMobileOpen(false); setOpenPanel(null); setQuery('') }
  const toggleTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); localStorage.setItem('kea-theme', next) }

  const sidebarContent = <>
    <BrandMark />
    <nav aria-label="Primary navigation">
      {nav.map((item) => <button type="button" key={item.id} className={active === item.id ? 'active' : ''} onClick={() => go(item.id)}><item.icon className="nav-icon" aria-hidden="true"/><span>{item.label}</span></button>)}
    </nav>
    <div className="sidebar-utilities">
      {utilityPages.map((item) => <button type="button" key={item.id} className={active === item.id ? 'active' : ''} onClick={() => go(item.id)}><item.icon className="nav-icon"/><span>{item.label}</span></button>)}
    </div>
    <button className="logout-button" onClick={onLogout}>Logout</button>
  </>

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>{sidebarContent}<button className="mobile-drawer-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X/></button></aside>
      {mobileOpen && <button className="mobile-menu-backdrop" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}

      <div className="app-main">
        <header className="topbar" ref={topbarRef}>
          <button className="hamburger" aria-label="Open menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu/></button>
          <div className="mobile-brand"><BrandMark compact /></div>

          <div className="topbar-control search-control">
            <div className="search-box"><Search aria-hidden="true"/><input aria-label="Search pages" placeholder="Search" value={query} onFocus={() => setOpenPanel('search')} onChange={(event) => { setQuery(event.target.value); setOpenPanel('search') }}/>{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X/></button>}</div>
            {openPanel === 'search' && <div className="topbar-panel search-results"><header><strong>Quick navigation</strong><button onClick={() => setOpenPanel(null)}><X/></button></header>{searchResults.length ? searchResults.map((item) => <button key={item.id} onClick={() => go(item.id)}><item.icon/><span><strong>{item.label}</strong><small>{item.keywords}</small></span></button>) : <p>No matching pages found.</p>}</div>}
          </div>

          <div className="topbar-control">
            <button aria-label="Notifications" className="round-action" aria-expanded={openPanel === 'notifications'} onClick={() => setOpenPanel(openPanel === 'notifications' ? null : 'notifications')}><Bell aria-hidden="true"/>{unread>0&&<b className="notification-count">{unread}</b>}</button>
            {openPanel === 'notifications' && <div className="topbar-panel notifications-panel"><header><strong>Notifications</strong><button onClick={() => setNotifications((items) => items.map((item) => ({...item, unread:false})))}><CheckCheck/>Mark all read</button></header>{notifications.map((item) => <button className={item.unread?'unread':''} key={item.id} onClick={() => setNotifications((items) => items.map((entry) => entry.id === item.id ? {...entry, unread:false} : entry))}><span></span><div><strong>{item.title}</strong><small>{item.detail}</small></div></button>)}</div>}
          </div>

          <button aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`} className="round-action" onClick={toggleTheme}>{theme === 'dark' ? <Sun/> : <Moon/>}</button>

          <div className="topbar-control profile-control">
            <button aria-label="Open profile menu" className="avatar profile-trigger" aria-expanded={openPanel === 'profile'} onClick={() => setOpenPanel(openPanel === 'profile' ? null : 'profile')}><img src="/kea-profile.png" alt=""/></button>
            {openPanel === 'profile' && <div className="topbar-panel profile-menu"><header><img src="/kea-profile.png" alt=""/><div><strong>Adela Parkson</strong><small>CID: 110733ap</small></div></header><button onClick={() => go('profile')}><SquareUserRound/>My profile</button><button onClick={() => go('settings')}><Settings/>Settings</button><button onClick={() => go('help')}><CircleHelp/>Help &amp; support</button><button className="profile-logout" onClick={onLogout}>Logout</button></div>}
          </div>
        </header>
        <section className="page-content">{children}</section>
        <small className="tariff-note">Dollar figures are illustrative at 30c/kWh; Kea Energy&apos;s real tariff is not public.</small>
      </div>
    </div>
  )
}
