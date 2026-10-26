// Étape 2 de l'onboarding : inviter les premiers membres.
//
// On y arrive juste après « Créer l’organisation ». Le créateur peut ajouter
// des personnes par email avec un rôle. Un compte existant est ajouté
// immédiatement ; sinon l'invitation reste en attente et sera acceptée
// automatiquement à la prochaine connexion avec cet email.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo.jsx'
import Icon from '../components/Icon.jsx'
import { useApp } from '../app/app-context.js'
import { useAuth } from '../app/auth-context.js'
import {
  inviteOrganizationMember,
  listOrganizationTeam,
  messageForError,
} from '../lib/api.js'

const INVITE_ROLES = [
  { value: 'member', label: 'Membre' },
  { value: 'admin', label: 'Administrateur' },
]

const ROLE_LABELS = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  member: 'Membre',
}

function initialOf(person) {
  const value = person.fullName || person.email || '?'
  return value.trim().slice(0, 1).toUpperCase()
}

export default function OnboardingMembersView() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { activeOrg, membershipRole, setActiveOrg } = useApp()
  const { user, organizationsLoaded } = useAuth()

  const orgId = searchParams.get('org') || activeOrg?.id || null
  const org = activeOrg?.id === orgId ? activeOrg : null
  const canInvite = membershipRole === 'owner' || membershipRole === 'admin'

  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState({ email: '', role: 'member' })
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Garde l'organisation active alignée avec le paramètre d'URL, notamment
  // après un rechargement de la page.
  useEffect(() => {
    if (orgId && activeOrg?.id !== orgId) setActiveOrg(orgId)
  }, [activeOrg?.id, orgId, setActiveOrg])

  useEffect(() => {
    if (organizationsLoaded && !orgId) {
      navigate('/onboarding', { replace: true })
    }
  }, [navigate, orgId, organizationsLoaded])

  useEffect(() => {
    if (!orgId) return undefined
    let mounted = true
    listOrganizationTeam(orgId)
      .then((rows) => {
        if (mounted) setTeam(rows)
      })
      .catch((error) => {
        if (mounted) setLoadError(messageForError(error))
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [orgId])

  const add = async (event) => {
    event.preventDefault()
    setFormError('')
    setNotice('')
    if (!canInvite) {
      setFormError('Seuls les propriétaires et administrateurs peuvent inviter des membres.')
      return
    }
    if (!form.email.trim()) {
      setFormError('Saisissez l’adresse email du membre.')
      return
    }
    setSubmitting(true)
    try {
      const result = await inviteOrganizationMember(orgId, form.email, form.role)
      if (result?.status === 'added') {
        setNotice(`${result.email} a été ajouté à l’organisation.`)
      } else if (result?.status === 'already_member') {
        setNotice(`${result.email} fait déjà partie de l’organisation.`)
      } else {
        setNotice(
          `Invitation enregistrée pour ${result?.email || form.email.trim()}. Elle sera acceptée à sa prochaine connexion avec cet email.`,
        )
      }
      setForm((value) => ({ ...value, email: '' }))
      setTeam(await listOrganizationTeam(orgId))
    } catch (error) {
      setFormError(messageForError(error))
    } finally {
      setSubmitting(false)
    }
  }

  const finish = () => navigate('/projects', { replace: true })

  return (
    <main className="td-onb">
      <Link to="/onboarding" className="td-onb-brand">
        <BrandLogo className="td-onb-logo" />
        <span>BOG</span>
      </Link>

      <section className="td-onb-card td-onb-card-wide">
        <h1 className="td-onb-title">Invitez votre équipe</h1>
        <p className="td-onb-sub">
          Ajoutez les personnes qui doivent accéder à{' '}
          <strong>{org?.name || 'votre organisation'}</strong>. Cette étape est
          facultative : vous pouvez la passer.
        </p>

        {canInvite ? (
          <form className="td-onb-invite" onSubmit={add} noValidate>
            <input
              className="td-onb-input"
              type="email"
              autoComplete="email"
              placeholder="prenom@entreprise.com"
              aria-label="Email du membre"
              value={form.email}
              onChange={(event) => {
                setForm((value) => ({ ...value, email: event.target.value }))
                setFormError('')
                setNotice('')
              }}
            />
            <div className="td-onb-select">
              <select
                className="td-onb-input"
                aria-label="Rôle du membre"
                value={form.role}
                onChange={(event) => setForm((value) => ({ ...value, role: event.target.value }))}
              >
                {INVITE_ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" className="td-onb-chevron" />
            </div>
            <button className="td-onb-add" type="submit" disabled={submitting}>
              {submitting ? 'Ajout…' : 'Ajouter'}
            </button>
          </form>
        ) : (
          <p className="td-onb-hint">
            Seuls les propriétaires et les administrateurs peuvent inviter des membres.
          </p>
        )}

        {formError ? (
          <p className="td-onb-error" role="alert">
            {formError}
          </p>
        ) : null}
        {notice ? (
          <p className="td-onb-notice" role="status">
            {notice}
          </p>
        ) : null}

        <div className="td-onb-team">
          <div className="td-onb-team-head">
            <span>Membres</span>
            <span>{team.length}</span>
          </div>

          {loading ? (
            <p className="td-onb-team-empty">Chargement des membres…</p>
          ) : loadError ? (
            <p className="td-onb-error">{loadError}</p>
          ) : team.length ? (
            team.map((person) => (
              <div className="td-onb-member" key={`${person.status}-${person.email}`}>
                <span className="td-onb-avatar" aria-hidden="true">
                  {initialOf(person)}
                </span>
                <span className="td-onb-member-main">
                  <span className="td-onb-member-name">
                    {person.fullName || person.email}
                    {person.userId && person.userId === user?.id ? ' (vous)' : ''}
                  </span>
                  {person.fullName ? (
                    <span className="td-onb-member-email">{person.email}</span>
                  ) : null}
                </span>
                <span className="td-onb-badge">{ROLE_LABELS[person.role] || person.role}</span>
                <span
                  className={
                    'td-onb-status' + (person.status === 'invited' ? ' is-invited' : '')
                  }
                >
                  {person.status === 'invited' ? 'Invité' : 'Actif'}
                </span>
              </div>
            ))
          ) : (
            <p className="td-onb-team-empty">Aucun membre pour l’instant.</p>
          )}

          <p className="td-onb-hint">
            Les invitations en attente s’activent automatiquement à la prochaine connexion
            avec l’email indiqué.
          </p>
        </div>

        <div className="td-onb-actions">
          <button type="button" className="td-onb-submit" onClick={finish}>
            Terminer la configuration
          </button>
          <button type="button" className="td-onb-skip" onClick={finish}>
            Passer cette étape
          </button>
        </div>
      </section>
    </main>
  )
}
