// Layout de l'application. Deux variantes :
// - `project` (défaut) : sidebar d'un projet (Dashboard, Test Runs…) + palette Ctrl+K ;
// - `org` : espace organisation (Projects, Analytics…), sans palette ni tiroir de run.
import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar.jsx'
import Header from './Header.jsx'
import OrgSidebar from './OrgSidebar.jsx'
import OrgHeader from './OrgHeader.jsx'
import CommandPalette from './CommandPalette.jsx'
import RunDrawer from './RunDrawer.jsx'

export default function AppShell({ variant = 'project' }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const isOrg = variant === 'org'

  const toggleSidebar = () => {
    if (window.innerWidth < 768) setMobileOpen((o) => !o)
    else setCollapsed((c) => !c)
  }

  const closeMobile = () => setMobileOpen(false)

  return (
    <div
      className={[
        'td-app',
        collapsed ? 'sb-collapsed' : '',
        mobileOpen ? 'sb-mobile-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {isOrg ? (
        <OrgSidebar onNavigate={closeMobile} onClose={closeMobile} />
      ) : (
        <Sidebar onClose={closeMobile} onNavigate={closeMobile} />
      )}
      <div className="td-sidebar-backdrop" onClick={closeMobile} />

      <div className="td-main">
        {isOrg ? (
          <OrgHeader onToggleSidebar={toggleSidebar} />
        ) : (
          <Header onToggleSidebar={toggleSidebar} />
        )}

        <main className="td-scroll">
          <Outlet />
        </main>
      </div>

      {isOrg ? null : (
        <>
          <CommandPalette />
          <RunDrawer />
        </>
      )}
    </div>
  )
}
