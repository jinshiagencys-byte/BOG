// Page « Utilisateurs et rôles » de l'espace organisation.
//
// Elle regroupe la gestion de l'équipe hors onboarding : membres actifs et
// invitations en attente dans un même tableau, avec le statut, le rôle et les
// dates. Les mutations passent par des RPC SECURITY DEFINER qui appliquent la
// hiérarchie owner > admin > member côté serveur ; l'UI ne fait que refléter
// ces règles.
import { useCallback, useEffect, useMemo, useState } from 'react'
import EmptyState from '../components/EmptyState.jsx'
import Icon from '../components/Icon.jsx'
import Toast from '../components/testcases/Toast.jsx'
import { useApp } from '../app/app-context.js'
import { useAuth } from '../app/auth-context.js'
import {
  inviteOrganizationMember,
  listOrganizationTeam,
  messageForError,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  sendOrganizationInviteEmail,
  updateOrganizationMemberRole,
} from '../lib/api.js'

const ROLES = [
  {
    value: 'owner',
    label: 'Propriétaire',
    hint: 'Contrôle total de l’organisation.',
  },
  {
    value: 'admin',
    label: 'Administrateur',
    hint: 'Gère les projets, les invitations et les membres.',
  },
  {
    value: 'member',
    label: 'Membre',
    hint: 'Consulte les projets et les exécutions.',
  },
]

const ROLE_LABELS = Object.fromEntries(ROLES.map((role) => [role.value, role.label]))
const ROLE_RANK = { owner: 0, admin: 1, member: 2 }
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function initialOf(person) {
  return String(person.fullName || person.email || '?').trim().slice(0, 1).toUpperCase()
}

function displayName(person) {
  return person.fullName || person.email || 'Membre'
}

export default function UsersView() {
  const { activeOrg, membershipRole } = useApp()
  const { user } = useAuth()

  const orgId = activeOrg?.id || null
  const isDemo = Boolean(activeOrg?.isDemo)
  const isOwner = membershipRole === 'owner'
  const canManage = !isDemo && (membershipRole === 'owner' || membershipRole === 'admin')

  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(!isDemo)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(null)
  const [invite, setInvite] = useState({ email: '', role: 'member' })
  const [inviteError, setInviteError] = useState('')
  const [inviting, setInviting] = useState(false)
  const [toast, setToast] = useState({ message: '', tone: 'success' })

  const notify = useCallback((message, tone = 'success') => {
    setToast({ message, tone })
  }, [])

  const load = useCallback(async () => {
    if (!orgId || isDemo) {
      setTeam([])
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError('')
    try {
      setTeam(await listOrganizationTeam(orgId))
    } catch (error) {
      setLoadError(messageForError(error))
    } finally {
      setLoading(false)
    }
  }, [isDemo, orgId])

  useEffect(() => {
    load()
  }, [load])

  // Les outils WebMCP peuvent modifier l’équipe depuis la page : on recharge
  // le tableau quand le pont signale un changement.
  useEffect(() => {
    const onTeamChanged = () => load()
    window.addEventListener('bog:team-changed', onTeamChanged)
    return () => window.removeEventListener('bog:team-changed', onTeamChanged)
  }, [load])

  const members = useMemo(
    () =>
      team
        .filter((person) => person.status === 'active')
        .sort(
          (a, b) =>
            (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) ||
            String(a.email).localeCompare(String(b.email), 'fr'),
        ),
    [team],
  )

  const invitations = useMemo(
    () =>
      team
        .filter((person) => person.status === 'invited')
        .sort(
          (a, b) =>
            new Date(b.createdAt || 0) - new Date(a.createdAt || 0) ||
            String(a.email).localeCompare(String(b.email), 'fr'),
        ),
    [team],
  )

  // Un seul tableau : membres actifs d'abord, invitations ensuite.
  const rows = useMemo(() => [...members, ...invitations], [members, invitations])

  const owners = members.filter((person) => person.role === 'owner').length
  const admins = members.filter((person) => person.role === 'admin').length

  const isSelf = (person) => Boolean(person.userId && user?.id && person.userId === user.id)
  const isLastOwner = (person) => person.role === 'owner' && owners <= 1

  const canEditRole = (person) => {
    if (!canManage || isSelf(person)) return false
    if (isOwner) return true
    // Un administrateur ne gère que les membres.
    return person.role === 'member'
  }

  const canRemove = (person) => {
    if (!canEditRole(person) || isLastOwner(person)) return false
    if (isOwner) return true
    return person.role === 'member'
  }

  const roleOptions = () =>
    isOwner ? ROLES : ROLES.filter((role) => role.value !== 'owner')

  const changeRole = async (person, nextRole) => {
    if (!orgId || nextRole === person.role) return
    setBusy(`role:${person.userId}`)
    try {
      await updateOrganizationMemberRole(orgId, person.userId, nextRole)
      setTeam((current) =>
        current.map((row) =>
          row.userId === person.userId ? { ...row, role: nextRole } : row,
        ),
      )
      notify(
        `${displayName(person)} est maintenant ${ROLE_LABELS[nextRole].toLowerCase()}.`,
      )
    } catch (error) {
      notify(messageForError(error), 'error')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const remove = async (person) => {
    if (!orgId) return
    const confirmed = window.confirm(
      `Retirer ${displayName(person)} de l’organisation ? Cette personne perdra immédiatement l’accès aux projets.`,
    )
    if (!confirmed) return
    setBusy(`remove:${person.userId}`)
    try {
      await removeOrganizationMember(orgId, person.userId)
      setTeam((current) => current.filter((row) => row.userId !== person.userId))
      notify(`${displayName(person)} a été retiré de l’organisation.`)
    } catch (error) {
      notify(messageForError(error), 'error')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const resend = async (person) => {
    if (!orgId) return
    setBusy(`resend:${person.email}`)
    try {
      const result = await sendOrganizationInviteEmail(orgId, person.email)
      if (result?.sent === false) {
        notify(
          messageForError({ code: result.error, message: result.detail }) ||
            'L’email n’a pas pu être envoyé.',
          'error',
        )
      } else {
        notify(`Invitation renvoyée à ${person.email}.`)
      }
    } catch (error) {
      notify(messageForError(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const revoke = async (person) => {
    if (!orgId) return
    const confirmed = window.confirm(
      `Révoquer l’invitation de ${person.email} ? Le lien reçu ne permettra plus de rejoindre l’organisation.`,
    )
    if (!confirmed) return
    setBusy(`revoke:${person.email}`)
    try {
      await revokeOrganizationInvitation(orgId, person.email)
      setTeam((current) =>
        current.filter(
          (row) => !(row.status === 'invited' && row.email === person.email),
        ),
      )
      notify(`Invitation de ${person.email} révoquée.`)
    } catch (error) {
      notify(messageForError(error), 'error')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const submitInvite = async (event) => {
    event.preventDefault()
    if (!orgId || !canManage) return
    const email = invite.email.trim().toLowerCase()
    setInviteError('')

    if (!email) {
      setInviteError('Saisissez une adresse email.')
      return
    }
    if (!EMAIL_RE.test(email)) {
      setInviteError(`L’adresse « ${email} » n’est pas valide.`)
      return
    }
    if (invite.role === 'owner') {
      setInviteError('Le rôle Propriétaire ne peut pas être attribué par invitation.')
      return
    }

    setInviting(true)
    try {
      const result = await inviteOrganizationMember(orgId, email, invite.role)

      if (result?.status === 'already_member') {
        notify(`${email} fait déjà partie de l’organisation.`, 'error')
        await load()
        return
      }

      let mail = null
      let emailError = ''
      try {
        mail = await sendOrganizationInviteEmail(orgId, email)
      } catch (error) {
        emailError = messageForError(error)
        setInviteError(emailError)
      }

      setTeam(await listOrganizationTeam(orgId))
      setInvite({ email: '', role: 'member' })

      if (emailError || mail?.sent === false) {
        notify(
          `Invitation enregistrée pour ${email}, mais l’email n’a pas pu être envoyé.`,
          'error',
        )
      } else {
        notify(`Invitation envoyée à ${email}.`)
      }
    } catch (error) {
      setInviteError(messageForError(error))
    } finally {
      setInviting(false)
    }
  }

  const orgName = activeOrg?.name || 'votre organisation'

  return (
    <>
      <div className="td-page-head td-admin-head">
        <div>
          <h1>Utilisateurs et rôles</h1>
          <p>
            Gérez les personnes qui accèdent à <strong>{orgName}</strong>. Les
            invitations sont acceptées automatiquement à la première connexion de
            la personne avec l’adresse indiquée.
          </p>
        </div>
        <div className="td-admin-head-meta">
          <span className="td-admin-org-chip">
            <span className="td-admin-org-avatar" aria-hidden="true">
              {orgName.slice(0, 1).toUpperCase()}
            </span>
            {orgName}
          </span>
          {membershipRole ? (
            <span className="td-admin-self-role">
              Votre rôle : <strong>{ROLE_LABELS[membershipRole] || membershipRole}</strong>
            </span>
          ) : null}
        </div>
      </div>

      {isDemo ? (
        <div className="td-card-surface td-settings-note">
          <Icon name="info" className="td-ic-16" />
          <span>
            La démonstration est en lecture seule : la gestion de l’équipe est
            désactivée.
          </span>
        </div>
      ) : null}

      {loadError ? (
        <div className="td-card-surface td-settings-note is-error">
          <Icon name="triangle-alert" className="td-ic-16" />
          <span>{loadError}</span>
          <button type="button" className="td-btn td-btn-ghost" onClick={load}>
            Réessayer
          </button>
        </div>
      ) : null}

      {!isDemo ? (
        <div className="td-admin-stats">
          <div className="td-admin-stat">
            <span className="td-admin-stat-label">Membres actifs</span>
            <strong className="td-admin-stat-value">{loading ? '—' : members.length}</strong>
            <span className="td-admin-stat-sub">Accès à l’organisation</span>
          </div>
          <div className="td-admin-stat">
            <span className="td-admin-stat-label">Invitations en attente</span>
            <strong className="td-admin-stat-value">
              {loading ? '—' : invitations.length}
            </strong>
            <span className="td-admin-stat-sub">En attente de connexion</span>
          </div>
          <div className="td-admin-stat">
            <span className="td-admin-stat-label">Propriétaires</span>
            <strong className="td-admin-stat-value">{loading ? '—' : owners}</strong>
            <span className="td-admin-stat-sub">Contrôle total</span>
          </div>
          <div className="td-admin-stat">
            <span className="td-admin-stat-label">Administrateurs</span>
            <strong className="td-admin-stat-value">{loading ? '—' : admins}</strong>
            <span className="td-admin-stat-sub">Gestion de l’équipe</span>
          </div>
        </div>
      ) : null}

      {canManage ? (
        <section className="td-card-surface td-admin-card">
          <div className="td-admin-card-head">
            <div>
              <h2>Inviter un membre</h2>
              <p>
                La personne reçoit un email et rejoint l’organisation à sa première
                connexion. Vous pouvez aussi lui attribuer le rôle Administrateur.
              </p>
            </div>
          </div>

          <form className="td-admin-invite" onSubmit={submitInvite} noValidate>
            <div className="td-field td-admin-invite-email">
              <label className="td-field-label" htmlFor="admin-invite-email">
                Adresse email <span className="td-req">*</span>
              </label>
              <input
                id="admin-invite-email"
                className="td-control"
                type="email"
                autoComplete="email"
                placeholder="prenom@entreprise.com"
                value={invite.email}
                disabled={inviting}
                onChange={(event) => {
                  setInvite({ ...invite, email: event.target.value })
                  setInviteError('')
                }}
              />
            </div>

            <div className="td-field td-admin-invite-role">
              <label className="td-field-label" htmlFor="admin-invite-role">
                Rôle
              </label>
              <select
                id="admin-invite-role"
                className="td-control"
                value={invite.role}
                disabled={inviting}
                onChange={(event) => setInvite({ ...invite, role: event.target.value })}
              >
                <option value="member">Membre</option>
                <option value="admin">Administrateur</option>
              </select>
            </div>

            <button
              type="submit"
              className="td-btn td-btn-primary td-admin-invite-submit"
              disabled={inviting}
            >
              <Icon name="plus" className="td-ic-16" />
              {inviting ? 'Envoi…' : 'Envoyer l’invitation'}
            </button>
          </form>

          {inviteError ? (
            <p className="td-admin-error" role="alert">
              {inviteError}
            </p>
          ) : null}
        </section>
      ) : null}

      {!canManage && !isDemo && membershipRole ? (
        <div className="td-card-surface td-settings-note">
          <Icon name="shield-check" className="td-ic-16" />
          <span>
            Votre rôle <strong>{ROLE_LABELS[membershipRole] || membershipRole}</strong>{' '}
            vous permet de consulter l’équipe, mais pas de la modifier. Demandez à un
            propriétaire ou à un administrateur pour inviter ou retirer un membre.
          </span>
        </div>
      ) : null}

      <section className="td-card-surface td-admin-card">
        <div className="td-admin-card-head">
          <div>
            <h2>Membres et invitations</h2>
            <p>Personnes ayant accès à l’organisation ou invitées à la rejoindre.</p>
          </div>
          <span className="td-admin-count">{loading ? '—' : rows.length}</span>
        </div>

        {loading ? (
          <p className="td-admin-empty">Chargement de l’équipe…</p>
        ) : rows.length ? (
          <div className="td-table-scroll">
            <table className="td-table td-admin-table">
              <thead>
                <tr>
                  <th>Personne</th>
                  <th>Statut</th>
                  <th>Rôle</th>
                  <th>Depuis</th>
                  <th>Invitée le</th>
                  <th className="td-admin-actions-col" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((person) => {
                  const isInvitation = person.status === 'invited'
                  const self = isSelf(person)
                  const pendingRole = busy === `role:${person.userId}`
                  return (
                    <tr
                      key={person.userId || `invite-${person.email}`}
                      className={isInvitation ? 'is-invitation' : undefined}
                    >
                      <td className="td-cell">
                        <span className="td-admin-person-chip">
                          <span
                            className={`td-admin-avatar${isInvitation ? ' is-muted' : ''}`}
                            aria-hidden="true"
                          >
                            {initialOf(person)}
                          </span>
                          <span className="td-admin-person-main">
                            <span className="td-admin-person-name">
                              {isInvitation ? person.email : displayName(person)}
                              {self ? <span className="td-admin-you">Vous</span> : null}
                            </span>
                            {!isInvitation && person.fullName ? (
                              <span className="td-admin-person-email">
                                {person.email}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </td>

                      <td className="td-cell">
                        <span
                          className={`td-admin-status-pill ${
                            isInvitation ? 'is-pending' : 'is-active'
                          }`}
                        >
                          {isInvitation ? 'En attente' : 'Actif'}
                        </span>
                      </td>

                      <td className="td-cell">
                        {!isInvitation && canEditRole(person) ? (
                          <select
                            className="td-control td-admin-role-select"
                            aria-label={`Rôle de ${displayName(person)}`}
                            value={person.role}
                            disabled={pendingRole || isLastOwner(person)}
                            title={
                              isLastOwner(person)
                                ? 'Nommez un autre propriétaire avant de changer ce rôle.'
                                : undefined
                            }
                            onChange={(event) => changeRole(person, event.target.value)}
                          >
                            {roleOptions().map((role) => (
                              <option key={role.value} value={role.value}>
                                {role.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className={`td-admin-role-pill is-${person.role}`}>
                            {ROLE_LABELS[person.role] || person.role}
                          </span>
                        )}
                      </td>

                      <td className="td-cell td-admin-date">
                        {isInvitation ? '—' : formatDate(person.createdAt)}
                      </td>
                      <td className="td-cell td-admin-date">
                        {isInvitation ? formatDate(person.createdAt) : '—'}
                      </td>

                      <td className="td-cell td-admin-actions-col">
                        {isInvitation ? (
                          canManage ? (
                            <span className="td-admin-row-actions">
                              <button
                                type="button"
                                className="td-btn td-btn-icon td-btn-ghost"
                                title="Renvoyer l’invitation"
                                aria-label={`Renvoyer l’invitation de ${person.email}`}
                                disabled={busy === `resend:${person.email}`}
                                onClick={() => resend(person)}
                              >
                                <Icon name="refresh-cw" className="td-ic-14" />
                              </button>
                              <button
                                type="button"
                                className="td-btn td-btn-icon td-btn-ghost td-btn-danger"
                                title="Révoquer l’invitation"
                                aria-label={`Révoquer l’invitation de ${person.email}`}
                                disabled={busy === `revoke:${person.email}`}
                                onClick={() => revoke(person)}
                              >
                                <Icon name="x" className="td-ic-14" />
                              </button>
                            </span>
                          ) : null
                        ) : canRemove(person) ? (
                          <button
                            type="button"
                            className="td-btn td-btn-icon td-btn-danger"
                            title={`Retirer ${displayName(person)}`}
                            aria-label={`Retirer ${displayName(person)} de l’organisation`}
                            disabled={busy === `remove:${person.userId}`}
                            onClick={() => remove(person)}
                          >
                            <Icon name="trash-2" className="td-ic-16" />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            compact
            icon="users"
            title="Aucun membre pour le moment"
            description="Invitez une première personne pour collaborer sur vos projets."
          />
        )}
      </section>

      <Toast
        message={toast.message}
        tone={toast.tone}
        onDone={() => setToast({ message: '', tone: 'success' })}
      />
    </>
  )
}
