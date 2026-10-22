// Header de l'espace **organisation** : fil d'ariane « <Organisation> > Page »,
// cloche du changelog et bascule de thème (comme sur app.testdino.com/org_…/projects).
import { useLocation } from 'react-router-dom'
import Icon from './Icon.jsx'
import ChangelogBell from './ChangelogBell.jsx'
import { useApp } from '../app/app-context.js'
import { ORG_NAV_FLAT } from '../app/nav.js'
import { DEMO_ORG_NAME } from '../app/projects.js'

export default function OrgHeader({ onToggleSidebar }) {
  const { theme, toggleTheme, organization, currentOrg } = useApp()
  const location = useLocation()
  const orgName = currentOrg === 'demo' ? DEMO_ORG_NAME : organization
  const current = ORG_NAV_FLAT.slice()
    .sort((a, b) => b.to.length - a.to.length)
    .find((i) => location.pathname.startsWith(i.to))

  return (
    <header className="td-header">
      <button
        className="td-iconbtn"
        type="button"
        aria-label="Afficher ou masquer le menu latéral"
        onClick={onToggleSidebar}
      >
        <Icon name="panel-left" className="td-ic-16" />
      </button>
      <div className="td-header-sep" />

      <nav className="td-breadcrumb" aria-label="breadcrumb">
        <Icon name="folder" className="td-ic-14" />
        <span>{orgName}</span>
        <Icon name="chevron-right" className="td-ic-14" />
        <span className="td-breadcrumb-current">{current ? current.name : 'Projects'}</span>
      </nav>

      <div className="td-header-spacer" />

      <ChangelogBell />

      <button
        className="td-iconbtn"
        type="button"
        aria-label="Changer de thème"
        onClick={toggleTheme}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="td-ic-16" />
      </button>
    </header>
  )
}
