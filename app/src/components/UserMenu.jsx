import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './Icon.jsx'
import { useAuth } from '../app/auth-context.js'
import { avatarColor, initials } from '../lib/format.js'

// Menu utilisateur du bas de sidebar : nom et e-mail réels, déconnexion.
export default function UserMenu() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const name = user?.user_metadata?.full_name || user?.email || 'Invité'
  const email = user?.email || 'Non connecté'
  const color = avatarColor(name)

  if (!user) {
    return (
      <button className="td-user-btn" type="button" onClick={() => navigate('/auth')}>
        <span className="td-user-avatar">?</span>
        <span className="td-user-info">
          <span className="td-user-name">Invité</span>
          <span className="td-user-mail">Se connecter</span>
        </span>
        <Icon name="log-in" className="td-chev" />
      </button>
    )
  }

  const logout = async () => {
    setOpen(false)
    await signOut()
    navigate('/auth', { replace: true })
  }

  return (
    <div className="td-user-wrap" ref={ref}>
      <button
        className="td-user-btn"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={`td-user-avatar bg-${color}-background text-${color}-foreground`}>
          {initials(name)}
        </span>
        <span className="td-user-info">
          <span className="td-user-name">{name}</span>
          <span className="td-user-mail">{email}</span>
        </span>
        <Icon name="chevrons-up-down" className="td-chev" />
      </button>

      {open ? (
        <div className="td-menu td-user-menu" role="menu">
          <div className="td-menu-label">Compte</div>
          <div className="td-user-menu-identity">
            <span className="td-user-name">{name}</span>
            <span className="td-user-mail">{email}</span>
          </div>
          <div className="td-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="td-menu-item"
            onClick={() => {
              setOpen(false)
              navigate('/org-settings')
            }}
          >
            <Icon name="settings" className="td-ic-16" />
            <span className="td-menu-name">Paramètres</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="td-menu-item"
            onClick={logout}
          >
            <Icon name="log-out" className="td-ic-16" />
            <span className="td-menu-name">Se déconnecter</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
