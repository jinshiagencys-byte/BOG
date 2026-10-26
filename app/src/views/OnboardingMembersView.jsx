// Étape 2 de l'onboarding : inviter les premiers membres.
//
// On y arrive juste après « Créer l’organisation ». Le créateur peut ajouter
// plusieurs personnes en une fois, avec un rôle par ligne. Un compte existant
// est ajouté immédiatement ; sinon l'invitation reste en attente et sera
// acceptée automatiquement à la prochaine connexion avec cet email.
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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

let rowSequence = 0

function newInvite() {
  rowSequence += 1
  return { id: `invite-${rowSequence}`, email: '', role: 'member' }
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
  const [invites, setInvites] = useState(() => [newInvite()])
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

  const updateInvite = (id, key, value) => {
    setInvites((rows) =>
      rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)),
    )
    setFormError('')
    setNotice('')
  }

  const addRow = () => {
    setInvites((rows) => [...rows, newInvite()])
    setFormError('')
    setNotice('')
  }

  const removeRow = (id) => {
    setInvites((rows) => (rows.length > 1 ? rows.filter((row) => row.id !== id) : rows))
    setFormError('')
    setNotice('')
  }

  const add = async (event) => {
    event.preventDefault()
    setFormError('')
    setNotice('')
    if (!canInvite) {
      setFormError('Seuls les propriétaires et administrateurs peuvent inviter des membres.')
      return
    }

    const rows = invites
      .map((row) => ({ ...row, email: row.email.trim() }))
      .filter((row) => row.email)

    if (!rows.length) {
      setFormError('Ajoutez au moins une adresse email.')
      return
    }

    const invalid = rows.find((row) => !EMAIL_RE.test(row.email))
    if (invalid) {
      setFormError(`L’adresse « ${invalid.email} » n’est pas valide.`)
      return
    }

    const seen = new Set()
    const duplicate = rows.find((row) => {
      const key = row.email.toLowerCase()
      if (seen.has(key)) return true
      seen.add(key)
      return false
    })
    if (duplicate) {
      setFormError(`L’adresse « ${duplicate.email} » est présente plusieurs fois.`)
      return
    }

    setSubmitting(true)
    try {
      const results = []
      const errors = []
      for (const row of rows) {
        try {
          const result = await inviteOrganizationMember(orgId, row.email, row.role)
          results.push(result)
        } catch (error) {
          errors.push({ row, message: messageForError(error) })
        }
      }

      try {
        setTeam(await listOrganizationTeam(orgId))
      } catch {
        /* la liste sera rechargée à la prochaine ouverture */
      }

      const added = results.filter((result) => result?.status === 'added').length
      const invited = results.filter((result) => result?.status === 'invited').length
      const already = results.filter((result) => result?.status === 'already_member').length
      const parts = []
      if (added) {
        parts.push(`${added} membre${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}`)
      }
      if (invited) {
        parts.push(
          `${invited} invitation${invited > 1 ? 's' : ''} enregistrée${invited > 1 ? 's' : ''}`,
        )
      }
      if (already) {
        parts.push(`${already} déjà membre${already > 1 ? 's' : ''}`)
      }
      if (errors.length) {
        parts.push(`${errors.length} erreur${errors.length > 1 ? 's' : ''}`)
      }
      if (parts.length) setNotice(`${parts.join(' · ')}.`)

      if (errors.length) {
        setFormError(
          errors.map(({ row, message }) => `${row.email} : ${message}`).join(' '),
        )
        setInvites(errors.map(({ row }) => ({ ...row })))
      } else {
        setInvites([newInvite()])
      }
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
          <form className="td-onb-invites" onSubmit={add} noValidate>
            <div className="td-onb-invite-list">
              {invites.map((invite, index) => (
                <div className="td-onb-invite-row" key={invite.id}>
                  <input
                    className="td-onb-input"
                    type="email"
                    autoComplete="email"
                    placeholder="prenom@entreprise.com"
                    aria-label={`Email du membre ${index + 1}`}
                    value={invite.email}
                    onChange={(event) => updateInvite(invite.id, 'email', event.target.value)}
                  />
                  <div className="td-onb-select">
                    <select
                      className="td-onb-input"
                      aria-label={`Rôle du membre ${index + 1}`}
                      value={invite.role}
                      onChange={(event) => updateInvite(invite.id, 'role', event.target.value)}
                    >
                      {INVITE_ROLES.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                    <Icon name="chevron-down" className="td-onb-chevron" />
                  </div>
                  <button
                    type="button"
                    className="td-onb-remove"
                    aria-label="Retirer cette ligne"
                    title="Retirer cette ligne"
                    disabled={invites.length === 1}
                    onClick={() => removeRow(invite.id)}
                  >
                    <Icon name="x" className="td-ic-16" />
                  </button>
                </div>
              ))}
            </div>

            <div className="td-onb-invite-actions">
              <button type="button" className="td-onb-plus" onClick={addRow}>
                <Icon name="plus" className="td-ic-16" />
                <span>Ajouter une ligne</span>
              </button>
              <button className="td-onb-add" type="submit" disabled={submitting}>
                {submitting
                  ? 'Ajout…'
                  : invites.length > 1
                    ? 'Ajouter les membres'
                    : 'Ajouter'}
              </button>
            </div>
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
