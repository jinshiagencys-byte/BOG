// Étape 3 de l'onboarding : rôle du créateur et invitations.
//
// On y arrive juste après « Créez votre organisation ». Le créateur choisit son
// rôle ici, puis peut ajouter plusieurs personnes en une fois. Chaque adresse
// reçoit un email d'invitation ; l'adhésion n'est créée qu'à la première
// authentification de la personne dans l'app.
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo.jsx'
import Icon from '../components/Icon.jsx'
import OnboardingStepper from '../components/OnboardingStepper.jsx'
import { useApp } from '../app/app-context.js'
import { useAuth } from '../app/auth-context.js'
import {
  inviteOrganizationMember,
  listOrganizationTeam,
  messageForError,
  sendOrganizationInviteEmail,
  setMyOrganizationRole,
} from '../lib/api.js'

const ROLES = [
  {
    value: 'owner',
    label: 'Propriétaire',
    hint: 'Contrôle total de l’organisation et de ses paramètres.',
  },
  {
    value: 'admin',
    label: 'Administrateur',
    hint: 'Peut gérer les projets, les intégrations et les paramètres.',
  },
  {
    value: 'member',
    label: 'Membre',
    hint: 'Peut consulter les projets et exécuter les tests.',
  },
]

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
  const { user, organizationsLoaded, refreshOrganizations } = useAuth()

  const orgId = searchParams.get('org') || activeOrg?.id || null
  const org = activeOrg?.id === orgId ? activeOrg : null
  const isCreator = Boolean(org?.createdBy && user?.id && org.createdBy === user.id)

  const [creatorRole, setCreatorRole] = useState(null)
  const [roleSaving, setRoleSaving] = useState(false)
  const [roleError, setRoleError] = useState('')

  const effectiveRole = creatorRole ?? membershipRole ?? 'admin'

  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [invites, setInvites] = useState(() => [newInvite()])
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const roleLoaded = Boolean(membershipRole)
  const canInvite =
    roleLoaded && (effectiveRole === 'owner' || effectiveRole === 'admin')

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

  const changeRole = async (next) => {
    if (!orgId || next === effectiveRole) return
    setCreatorRole(next)
    setRoleError('')
    setFormError('')
    setNotice('')
    setRoleSaving(true)
    try {
      await setMyOrganizationRole(orgId, next)
      await refreshOrganizations()
    } catch (error) {
      setCreatorRole(null)
      setRoleError(messageForError(error))
    } finally {
      setRoleSaving(false)
    }
  }

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
          let emailSent = false
          let emailError = ''

          if (result?.status === 'invited') {
            try {
              const mail = await sendOrganizationInviteEmail(orgId, row.email)
              emailSent = mail?.sent !== false
              emailError = mail?.sent === false ? mail?.error || 'INVITE_EMAIL_FAILED' : ''
            } catch (error) {
              emailError = error?.code || 'INVITE_EMAIL_FAILED'
            }
          }

          results.push({ ...result, emailSent, emailError })
        } catch (error) {
          errors.push({ row, message: messageForError(error) })
        }
      }

      try {
        setTeam(await listOrganizationTeam(orgId))
      } catch {
        /* la liste sera rechargée à la prochaine ouverture */
      }

      const invited = results.filter((result) => result?.status === 'invited')
      const emailed = invited.filter((result) => result.emailSent).length
      const unemailed = invited.length - emailed
      const already = results.filter((result) => result?.status === 'already_member').length
      const parts = []
      if (emailed) {
        parts.push(
          `${emailed} invitation${emailed > 1 ? 's' : ''} envoyée${emailed > 1 ? 's' : ''} par email`,
        )
      }
      if (unemailed) {
        parts.push(
          `${unemailed} invitation${unemailed > 1 ? 's' : ''} enregistrée${unemailed > 1 ? 's' : ''} (email non envoyé)`,
        )
      }
      if (already) {
        parts.push(`${already} déjà membre${already > 1 ? 's' : ''}`)
      }
      if (errors.length) {
        parts.push(`${errors.length} erreur${errors.length > 1 ? 's' : ''}`)
      }
      if (parts.length) setNotice(`${parts.join(' · ')}.`)

      const rateLimited = results.some(
        (result) => result?.emailError === 'EMAIL_RATE_LIMITED',
      )
      if (rateLimited) {
        setFormError(
          'Supabase limite temporairement l’envoi d’emails. Les invitations sont enregistrées et seront acceptées à la première connexion ; réessayez l’envoi plus tard.',
        )
      }

      if (errors.length) {
        setFormError((previous) =>
          [
            previous,
            errors.map(({ row, message }) => `${row.email} : ${message}`).join(' '),
          ]
            .filter(Boolean)
            .join(' '),
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

  const selectedRole =
    ROLES.find((role) => role.value === effectiveRole) || ROLES[1]

  return (
    <main className="td-onb">
      <Link to="/onboarding" className="td-onb-brand">
        <BrandLogo className="td-onb-logo" />
        <span>BOG</span>
      </Link>

      <OnboardingStepper current={2} wide />

      <section className="td-onb-card td-onb-card-wide">
        <h1 className="td-onb-title">Invitez votre équipe</h1>
        <p className="td-onb-sub">
          Ajoutez les personnes qui doivent accéder à{' '}
          <strong>{org?.name || 'votre organisation'}</strong>. Chacune recevra
          une invitation par email et rejoindra l’organisation à sa première
          connexion. Cette étape est facultative : vous pouvez la passer.
        </p>

        {isCreator ? (
          <div className="td-onb-field td-onb-role-field">
            <label className="td-onb-label" htmlFor="onb-creator-role">
              Votre rôle <span className="td-req">*</span>
            </label>
            <div className="td-onb-select">
              <select
                id="onb-creator-role"
                className="td-onb-input"
                value={effectiveRole}
                disabled={roleSaving}
                onChange={(event) => changeRole(event.target.value)}
              >
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" className="td-onb-chevron" />
            </div>
            <p className="td-onb-hint">{selectedRole.hint}</p>
            {roleSaving ? <p className="td-onb-hint">Enregistrement du rôle…</p> : null}
            {roleError ? (
              <p className="td-onb-error" role="alert">
                {roleError}
              </p>
            ) : null}
          </div>
        ) : null}

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
              <button
                className="td-onb-add"
                type="submit"
                disabled={submitting || roleSaving}
              >
                {submitting
                  ? 'Envoi…'
                  : invites.length > 1
                    ? 'Ajouter les membres'
                    : 'Ajouter'}
              </button>
            </div>
          </form>
        ) : roleLoaded ? (
          <p className="td-onb-hint td-onb-role-blocked">
            {effectiveRole === 'member'
              ? 'En tant que membre, vous ne pouvez pas inviter d’autres personnes. Choisissez Administrateur ou Propriétaire pour envoyer des invitations.'
              : 'Seuls les propriétaires et les administrateurs peuvent inviter des membres.'}
          </p>
        ) : null}

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
            Une invitation en attente devient une adhésion active dès que la personne
            se connecte à l’app avec l’email indiqué.
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
