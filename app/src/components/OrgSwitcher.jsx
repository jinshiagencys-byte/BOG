// Sélecteur d'organisation du haut de la sidebar — présent sur les deux espaces.
//
// Relevé sur app.testdino.com (pages projet et organisation) : le bouton ouvre un
// menu « Organisations » listant les organisations (avec « Données de démonstration en lecture seule »
// sur la sandbox de démo et une coche sur l'organisation courante), puis
// « Gérer l’organisation », « Gérer l’équipe » et « Nouvelle organisation ».
// Choisir une organisation bascule d'espace et ouvre sa page Projects.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Icon from './Icon.jsx'
import { useApp } from '../app/app-context.js'
import { DEMO_ORG_NAME, DEMO_PROJECT_SLUG } from '../app/projects.js'

export default function OrgSwitcher({ onNavigate }) {
  const { activeOrg, organizations, setActiveOrg } = useApp()
  const { project } = useParams()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // L'organisation courante : celle du projet ouvert, sinon l'organisation active.
  const isDemo = project === DEMO_PROJECT_SLUG || Boolean(activeOrg?.isDemo)
  const currentOrgName = isDemo ? DEMO_ORG_NAME : activeOrg?.name || 'Organisation'

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const switchTo = (orgId) => {
    setActiveOrg(orgId)
    setOpen(false)
    if (onNavigate) onNavigate()
    navigate('/projects')
  }

  const go = (to) => {
    setOpen(false)
    if (onNavigate) onNavigate()
    navigate(to)
  }

  return (
    <div className="td-org-wrap" ref={ref}>
      <button
        className="td-org-btn"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="org-switcher-trigger"
        aria-label={`Organisation actuelle : ${currentOrgName}. Changer d’organisation`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="td-org-avatar">{currentOrgName.slice(0, 1).toUpperCase()}</span>
        <span className="td-org-name" data-testid="org-switcher-name-text">
          {currentOrgName}
        </span>
        <Icon name="chevrons-up-down" className="td-chev" />
      </button>

      {open ? (
        <div className="td-menu" role="menu" data-testid="org-switcher-menu">
          <div className="td-menu-label" data-testid="org-switcher-organizations-label">
            Organisations
          </div>

          {organizations.map((org) => (
            <button
              key={org.id}
              type="button"
              role="menuitem"
              className="td-menu-item"
              data-testid="org-switcher-item-current"
              onClick={() => switchTo(org.id)}
            >
              <span className="td-menu-avatar">{org.name.slice(0, 1).toUpperCase()}</span>
              <span className="td-menu-text">
                <span className="td-menu-name">{org.name}</span>
                <span className="td-menu-desc">
                  {org.role === 'owner'
                    ? 'Propriétaire'
                    : org.role === 'admin'
                      ? 'Administrateur'
                      : 'Membre'}
                </span>
              </span>
              {!isDemo && activeOrg?.id === org.id ? (
                <Icon name="check" className="td-ic-16 td-menu-check" />
              ) : null}
            </button>
          ))}

          {!organizations.length ? (
            <button
              type="button"
              role="menuitem"
              className="td-menu-item"
              onClick={() => go('/onboarding')}
            >
              <Icon name="plus" className="td-ic-16" />
              <span className="td-menu-name">Créer une organisation</span>
            </button>
          ) : null}

          <button
            type="button"
            role="menuitem"
            className="td-menu-item"
            data-testid="org-switcher-sandbox-item"
            onClick={() => switchTo('demo')}
          >
            <span className="td-menu-avatar">{DEMO_ORG_NAME.slice(0, 1).toUpperCase()}</span>
            <span className="td-menu-text">
              <span className="td-menu-name">{DEMO_ORG_NAME}</span>
              <span className="td-menu-desc">Données de démonstration en lecture seule</span>
            </span>
            {isDemo ? <Icon name="check" className="td-ic-16 td-menu-check" /> : null}
          </button>

          <div className="td-menu-sep" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="td-menu-item"
            data-testid="org-switcher-manage-org"
            onClick={() => go('/org-settings')}
          >
            <Icon name="settings" className="td-ic-16" />
            <span className="td-menu-name">Gérer l’organisation</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="td-menu-item"
            data-testid="org-switcher-manage-team"
            onClick={() => go('/users')}
          >
            <Icon name="users" className="td-ic-16" />
            <span className="td-menu-name">Gérer l’équipe</span>
          </button>

          <div className="td-menu-sep" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="td-menu-item"
            data-testid="org-switcher-new-org-btn"
            onClick={() => go('/onboarding')}
          >
            <Icon name="plus" className="td-ic-16" />
            <span className="td-menu-name">Nouvelle organisation</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
