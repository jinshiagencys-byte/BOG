// Page d'onboarding « Create your organization » (app.testdino.com/onboarding).
//
// Elle vit **hors du shell** (pas de sidebar ni de header) : c'est l'écran plein
// page affiché juste après la connexion, tant qu'aucune organisation n'existe.
// Valider crée l'organisation puis redirige vers `/projects` (l'espace
// organisation du clone), qui invite à créer un premier projet.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo.jsx'
import { useApp } from '../app/app-context.js'
import { useAuth } from '../app/auth-context.js'
import { createOrganization, messageForError } from '../lib/api.js'

// Tailles d'équipe : ce sont les 6 valeurs affichées sur le site réel.
const TEAM_SIZES = ['1', '2-10', '11-50', '51-100', '101-250', '250+']

export default function OnboardingView() {
  const navigate = useNavigate()
  const { setActiveOrg } = useApp()
  const { refreshOrganizations } = useAuth()
  const [form, setForm] = useState({ name: '', teamSize: '' })
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e))
  }

  // Les champs sont marqués obligatoires (`*`) sur le site : on valide à la
  // soumission, on enregistre l'organisation puis on rejoint son espace.
  // Le rôle du créateur est choisi à l'étape suivante, avec les invitations.
  const submit = async (event) => {
    event.preventDefault()
    setSubmitError('')
    const next = {}
    if (!form.name.trim()) next.name = 'Veuillez saisir le nom de votre organisation.'
    if (!form.teamSize) next.teamSize = 'Veuillez sélectionner la taille de votre équipe.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      const org = await createOrganization(form.name, 'admin')
      await refreshOrganizations()
      setActiveOrg(org.id)
      navigate(`/onboarding/members?org=${encodeURIComponent(org.id)}`, { replace: true })
    } catch (error) {
      setSubmitError(messageForError(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="td-onb">
      <div className="td-onb-brand">
        <BrandLogo className="td-onb-logo" />
        <span>BOG</span>
      </div>

      <form className="td-onb-card" onSubmit={submit} noValidate>
        <h1 className="td-onb-title">Créez votre organisation</h1>
        <p className="td-onb-sub">
          C’est ici que se trouvent les exécutions de tests, les rapports et les membres de votre
          équipe. Vous pourrez modifier ces informations plus tard.
        </p>

        <div className="td-onb-form">
          <div className="td-onb-field">
            <label className="td-onb-label" htmlFor="onb-name">
              Nom de l’organisation <span className="td-req">*</span>
            </label>
            <input
              id="onb-name"
              className="td-onb-input"
              autoFocus
              autoComplete="organization"
              value={form.name}
              aria-invalid={Boolean(errors.name)}
              onChange={(e) => set('name', e.target.value)}
            />
            {errors.name ? <p className="td-onb-error">{errors.name}</p> : null}
          </div>

          <div className="td-onb-field">
            <span className="td-onb-label" id="onb-size-label">
              Taille de l’équipe <span className="td-req">*</span>
            </span>
            <div className="td-onb-sizes" role="radiogroup" aria-labelledby="onb-size-label">
              {TEAM_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={form.teamSize === size}
                  className={'td-onb-size' + (form.teamSize === size ? ' is-active' : '')}
                  onClick={() => set('teamSize', size)}
                >
                  {size}
                </button>
              ))}
            </div>
            <p className="td-onb-hint">
              Vous choisirez votre rôle et pourrez inviter des membres à l’étape suivante.
            </p>
            {errors.teamSize ? <p className="td-onb-error">{errors.teamSize}</p> : null}
          </div>

          {submitError ? (
            <p className="td-onb-error" role="alert">
              {submitError}
            </p>
          ) : null}

          <div className="td-onb-actions">
            <button type="submit" className="td-onb-submit" disabled={submitting}>
              {submitting ? 'Création…' : 'Créer l’organisation'}
            </button>
            <p className="td-onb-legal">
              En créant une organisation, vous acceptez notre{' '}
              <a href="#/">politique de confidentialité</a> et nos{' '}
              <a href="#/">conditions d’utilisation</a>.
            </p>
          </div>
        </div>
      </form>
    </main>
  )
}
