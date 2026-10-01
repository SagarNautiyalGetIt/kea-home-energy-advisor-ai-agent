import type { ComponentType, FocusEvent, MouseEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bell, ChartNoAxesColumnIncreasing, CheckCheck, CircleDollarSign, CircleHelp, House, ListChecks, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Search, Settings, SquareUserRound, Sun, X, type LucideProps } from 'lucide-react'
import BrandMark from './BrandMark'
import SparkyIcon from './SparkyIcon'
import { CUSTOMER_PROFILE_PHOTO } from '../lib/profileAssets'
import { loadSession } from '../lib/session'
import type { PageId } from '../types/navigation'

// Plans is back in scope for Sprint 2, so its navigation and search entry are
// exposed again. Set this to false to hide the entry without touching the route.
const SHOW_PLANS_NAV_ITEM = true
// Temporarily hide Profile from the navigation during Sprint 2. Its page and
// route remain available; change this flag to true when it should be exposed.
const SHOW_PROFILE_NAV_ITEM = false
// The top-bar light/dark shortcut. Settings also switches the theme; set this to false to
// leave that as the only way.
const SHOW_THEME_TOGGLE = true

// Any icon that takes lucide's props: lucide's own, or the site's Sparky icon.
type NavItem = { id: PageId; label: string; icon: ComponentType<LucideProps>; description: string; keywords: string }

// `description` is what the search panel shows; `keywords` only feeds the match,
// so synonyms customers might type can live there without cluttering the list.
const allNavItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: House, description: 'Energy flow, cost summary, bill warning and news', keywords: 'home overview projection bill shock warning today monthly' },
  { id: 'usage', label: 'Usage', icon: ChartNoAxesColumnIncreasing, description: 'Daily, weekly and monthly electricity use', keywords: 'graph chart energy kwh peak off-peak night consumption' },
  { id: 'billing', label: 'Billing', icon: CircleDollarSign, description: 'Invoices, payment status and saved card', keywords: 'bill pay invoice history balance due receipt' },
  { id: 'plans', label: 'Plans', icon: ListChecks, description: 'Pricing styles, terms and plan comparison', keywords: 'pricing compare tariff rate anytime time of use free weekends commitment credit' },
  { id: 'assistant', label: 'Sparky AI', icon: SparkyIcon, description: 'Ask about your bill, usage and plans', keywords: 'ai assistant chat question explain bill explainer' },
  { id: 'profile', label: 'Profile', icon: SquareUserRound, description: 'Your customer and contact details', keywords: 'account name address phone email password' },
]

const nav = allNavItems.filter((item) => {
  if (item.id === 'plans') return SHOW_PLANS_NAV_ITEM
  if (item.id === 'profile') return SHOW_PROFILE_NAV_ITEM
  return true
})

const utilityPages: NavItem[] = [
  { id: 'settings', label: 'Settings', icon: Settings, description: 'Theme, notifications and privacy', keywords: 'preferences alerts dark mode account' },
  { id: 'help', label: 'Help & Support', icon: CircleHelp, description: 'FAQs and ways to reach the support team', keywords: 'contact call email customer care question answers' },
]

type AppShellProps = {
  active?: PageId
  onNavigate: (page: PageId) => void
  onLogout: () => void
  children: ReactNode
}

export default function AppShell({ active, onNavigate, onLogout, children }: AppShellProps) {
  const session = loadSession()
  const customerName = session?.displayName ?? 'Adela Parkson'
  const customerId = session?.customerId ?? '110733ap'
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(localStorage.getItem('kea-sidebar-collapsed') === 'true')
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
    // The search results have no close button, so Escape is the keyboard's way out.
    const closeOnEscape = (event: KeyboardEvent) => { if (openPanel && event.key === 'Escape') setOpenPanel(null) }
    document.addEventListener('pointerdown', closePanels)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closePanels)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openPanel])

  const searchResults = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return [...nav, ...utilityPages]
    return [...nav, ...utilityPages].filter((item) => `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(term))
  }, [query])
  const unread = notifications.filter((item) => item.unread).length
  const go = (page: PageId) => { onNavigate(page); setMobileOpen(false); setOpenPanel(null); setQuery('') }
  const toggleTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); localStorage.setItem('kea-theme', next) }
  const toggleSidebar = () => { const next = !collapsed; setCollapsed(next); localStorage.setItem('kea-sidebar-collapsed', String(next)) }

  // Collapsed, the labels are hidden, so a small tooltip names the button under the pointer,
  // just below and right of it like the browser's own `title` tooltip, but at once rather
  // than after its one-second delay. Keyboard focus shows it beside the button instead.
  // Rendered into <body>, so nothing on the page can clip or cover it.
  const [navTip, setNavTip] = useState<{ label: string; x: number; y: number } | null>(null)
  const tipFor = (label: string) => collapsed ? {
    'aria-label': label,
    onMouseMove: (event: MouseEvent) => setNavTip({ label, x: event.clientX + 12, y: event.clientY + 18 }),
    onMouseLeave: () => setNavTip(null),
    onFocus: (event: FocusEvent<HTMLButtonElement>) => {
      const box = event.currentTarget.getBoundingClientRect()
      setNavTip({ label, x: box.right - 16, y: box.top + box.height / 2 - 12 })
    },
    onBlur: () => setNavTip(null),
  } : {}

  const sidebarContent = <>
    <BrandMark />
    <button
      type="button"
      className="sidebar-toggle"
      aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
      aria-expanded={!collapsed}
      title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
      onClick={toggleSidebar}
    >{collapsed ? <PanelLeftOpen aria-hidden="true"/> : <PanelLeftClose aria-hidden="true"/>}</button>
    {/* Collapsed, the buttons are named by `navTip` rather than a `title`, which would stack
        the slow native tooltip on top of it. */}
    <nav aria-label="Primary navigation">
      {nav.map((item) => <button type="button" key={item.id} className={active === item.id ? 'active' : ''} onClick={() => go(item.id)} {...tipFor(item.label)}><item.icon className="nav-icon" aria-hidden="true"/><span>{item.label}</span></button>)}
    </nav>
    <div className="sidebar-utilities">
      {utilityPages.map((item) => <button type="button" key={item.id} className={active === item.id ? 'active' : ''} onClick={() => go(item.id)} {...tipFor(item.label)}><item.icon className="nav-icon"/><span>{item.label}</span></button>)}
      <button type="button" onClick={onLogout} {...tipFor('Logout')}><LogOut className="nav-icon" aria-hidden="true"/><span>Logout</span></button>
    </div>
  </>

  return (
    <div className={`app-shell page-${active ?? 'default'} ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="kea-energy-decor" aria-hidden="true">
        <span className="kea-energy-burst kea-energy-burst-right"><img src="/assets/backgrounds/electric-energy-burst.svg" alt="" /></span>
        {/* On every page, like the right-hand burst; it used to be drawn on the dashboard only. */}
        <span className="kea-energy-burst kea-energy-burst-left"><img src="/assets/backgrounds/electric-energy-burst.svg" alt="" /></span>
      </div>
      <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>{sidebarContent}<button className="mobile-drawer-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X/></button></aside>
      {collapsed && navTip && createPortal(<div className="nav-tooltip" role="tooltip" style={{ left: navTip.x, top: navTip.y }}>{navTip.label}</div>, document.body)}
      {mobileOpen && <button className="mobile-menu-backdrop" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}

      <div className="app-main">
        <header className="topbar" ref={topbarRef}>
          <button className="hamburger" aria-label="Open menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu/></button>
          <div className="mobile-brand"><BrandMark compact /></div>

          <div className="topbar-cluster">
            <div className="topbar-control search-control">
            <div className="search-box"><Search aria-hidden="true"/><input aria-label="Search pages" placeholder="Search" value={query} onFocus={() => setOpenPanel('search')} onChange={(event) => { setQuery(event.target.value); setOpenPanel('search') }}/>{query && <button aria-label="Clear search" onClick={() => setQuery('')}><X/></button>}</div>
            {openPanel === 'search' && <div className="topbar-panel search-results">{searchResults.length ? searchResults.map((item) => <button key={item.id} onClick={() => go(item.id)}><item.icon/><span><strong>{item.label}</strong><small>{item.description}</small></span></button>) : <p>No matching pages found.</p>}</div>}
            </div>

            <div className="topbar-control">
              <button aria-label="Notifications" className="round-action" aria-expanded={openPanel === 'notifications'} onClick={() => setOpenPanel(openPanel === 'notifications' ? null : 'notifications')}><Bell aria-hidden="true"/>{unread>0&&<b className="notification-count">{unread}</b>}</button>
              {openPanel === 'notifications' && <div className="topbar-panel notifications-panel"><header><strong>Notifications</strong><button onClick={() => setNotifications((items) => items.map((item) => ({...item, unread:false})))}><CheckCheck/>Mark all read</button></header>{notifications.map((item) => <button className={item.unread?'unread':''} key={item.id} onClick={() => setNotifications((items) => items.map((entry) => entry.id === item.id ? {...entry, unread:false} : entry))}><span></span><div><strong>{item.title}</strong><small>{item.detail}</small></div></button>)}</div>}
            </div>

            {SHOW_THEME_TOGGLE && <button aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`} className="round-action" onClick={toggleTheme}>{theme === 'dark' ? <Sun/> : <Moon/>}</button>}

            <div className="topbar-control profile-control">
              <button aria-label="Open profile menu" className="avatar profile-trigger" aria-expanded={openPanel === 'profile'} onClick={() => setOpenPanel(openPanel === 'profile' ? null : 'profile')}><img src={CUSTOMER_PROFILE_PHOTO} alt=""/></button>
              {openPanel === 'profile' && <div className="topbar-panel profile-menu"><header><img src={CUSTOMER_PROFILE_PHOTO} alt=""/><div><strong>{customerName}</strong><small>CID: {customerId}</small></div></header><button onClick={() => go('profile')}><SquareUserRound/>My Profile</button><button onClick={() => go('settings')}><Settings/>Settings</button><button onClick={() => go('help')}><CircleHelp/>Help &amp; Support</button><button onClick={onLogout}><LogOut/>Logout</button></div>}
            </div>
          </div>
        </header>
        <section className="page-content">{children}</section>
        <small className="tariff-note">© 2026 Kea Energy. All rights reserved. Made with love by HAKAS.</small>
      </div>
    </div>
  )
}
