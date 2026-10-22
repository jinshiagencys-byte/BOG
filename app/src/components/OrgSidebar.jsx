// Sidebar de l'espace **organisation** (page /projects) : groupes Workspace /
// General et utilisateur, comme sur le site.
import { NavLink } from 'react-router-dom'
import Icon from './Icon.jsx'
import OrgSwitcher from './OrgSwitcher.jsx'
import { ORG_NAV_GROUPS } from '../app/nav.js'

export default function OrgSidebar({ onNavigate, onClose }) {
  return (
    <aside className="td-sidebar" aria-label="Navigation organisation">
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
        {ORG_NAV_GROUPS.map((group) => (
          <div className="td-nav-group" key={group.label}>
            <div className="td-nav-label">{group.label}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) => (isActive ? 'is-active' : '')}
              >
                <Icon name={item.icon} />
                <span>{item.name}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="td-sidebar-footer">
        <button className="td-user-btn" type="button">
          <span className="td-user-avatar">AJ</span>
          <span className="td-user-info">
            <span className="td-user-name">Agency&apos;s Jinshi</span>
            <span className="td-user-mail">jinshiagencys@gmail.com</span>
          </span>
          <Icon name="chevrons-up-down" className="td-chev" />
        </button>
      </div>
    </aside>
  )
}
