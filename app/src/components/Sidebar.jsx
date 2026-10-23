import { NavLink, useParams } from 'react-router-dom'
import Icon from './Icon.jsx'
import OrgSwitcher from './OrgSwitcher.jsx'
import UserMenu from './UserMenu.jsx'
import { NAV_GROUPS } from '../app/nav.js'

export default function Sidebar({ onNavigate, onClose }) {
  // Les URLs d'un projet sont préfixées par son slug : /DemoProject/dashboard.
  const { project } = useParams()

  return (
    <aside className="td-sidebar" aria-label="Navigation">
      <div className="td-sidebar-header">
        <OrgSwitcher onNavigate={onNavigate} />
        <button
          className="td-iconbtn td-sidebar-mobile-close"
          type="button"
          aria-label="Fermer le menu"
          onClick={onClose}
        >
          <Icon name="x" className="td-ic-16" />
        </button>
      </div>

      <nav className="td-nav">
        {NAV_GROUPS.map((group) => (
          <div className="td-nav-group" key={group.label}>
            <div className="td-nav-label">{group.label}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={`/${project}${item.to}`}
                onClick={onNavigate}
                className={({ isActive }) =>
                  [isActive ? 'is-active' : '', item.ai ? 'is-ai' : ''].filter(Boolean).join(' ')
                }
              >
                <Icon name={item.icon} />
                <span>{item.name}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="td-sidebar-footer">
        <UserMenu />
      </div>
    </aside>
  )
}
