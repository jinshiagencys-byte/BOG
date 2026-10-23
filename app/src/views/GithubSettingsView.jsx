import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import Toast from '../components/testcases/Toast.jsx'
import { useApp } from '../app/app-context.js'
import {
  deleteGithubIntegration,
  messageForError,
  saveGithubIntegration,
} from '../lib/api.js'

const EMPTY_FORM = {
  repoFullName: '',
  workflowFile: 'antigravity-qa.yml',
  defaultBranch: 'main',
  installationId: '',
  isActive: true,
}

export default function GithubSettingsView() {
  const {
    activeOrg,
    membershipRole,
    githubIntegration,
    githubLoading,
    githubError,
    refreshGithubIntegration,
    refreshProjects,
  } = useApp()

  const canEdit = membershipRole === 'owner' || membershipRole === 'admin'
  const isDemo = Boolean(activeOrg?.isDemo)

  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [toastTone, setToastTone] = useState('success')

  useEffect(() => {
    if (!githubIntegration) {
      setForm(EMPTY_FORM)
      return
    }
    setForm({
      repoFullName: githubIntegration.repoFullName || '',
      workflowFile: githubIntegration.workflowFile || 'antigravity-qa.yml',
      defaultBranch: githubIntegration.defaultBranch || 'main',
      installationId: githubIntegration.installationId
        ? String(githubIntegration.installationId)
        : '',
      isActive: githubIntegration.isActive !== false,
    })
  }, [githubIntegration])

  const set = (key) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((current) => ({ ...current, [key]: value }))
    setError('')
  }

  const connected = Boolean(
    githubIntegration?.isActive &&
      githubIntegration?.installationId &&
      githubIntegration?.repoFullName,
  )

  const submit = async (event) => {
    event.preventDefault()
    setError('')

    if (!activeOrg || isDemo) {
      setError('Sélectionnez une organisation réelle.')
      return
    }
    if (!canEdit) {
      setError('Seuls les propriétaires et administrateurs peuvent modifier cette intégration.')
      return
    }
    if (!/^[\w.-]+\/[\w.-]+$/.test(form.repoFullName.trim())) {
      setError('Le dépôt doit être au format owner/repo, par exemple jinshiagencys-byte/BOG.')
      return
    }
    if (form.isActive && !/^\d+$/.test(form.installationId.trim())) {
      setError("L'identifiant d'installation GitHub doit être un nombre entier.")
      return
    }

    setSaving(true)
    try {
      await saveGithubIntegration(
        activeOrg.id,
        {
          repoFullName: form.repoFullName.trim(),
          workflowFile: form.workflowFile.trim() || 'antigravity-qa.yml',
          defaultBranch: form.defaultBranch.trim() || 'main',
          installationId: form.installationId.trim()
            ? Number(form.installationId.trim())
            : null,
          isActive: form.isActive,
        },
        githubIntegration?.id || null,
      )
      await refreshGithubIntegration()
      await refreshProjects()
      setToastTone('success')
      setToast('Intégration GitHub enregistrée.')
    } catch (saveError) {
      setError(messageForError(saveError))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!githubIntegration) return
    if (!window.confirm('Supprimer cette intégration GitHub ? Les exécutions ne pourront plus démarrer.')) {
      return
    }
    setSaving(true)
    setError('')
    try {
      await deleteGithubIntegration(githubIntegration.id)
      await refreshGithubIntegration()
      await refreshProjects()
      setToastTone('success')
      setToast('Intégration GitHub supprimée.')
    } catch (deleteError) {
      setError(messageForError(deleteError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="td-page-head">
        <h1>Paramètres de l’organisation</h1>
        <p>
          Reliez l’organisation au dépôt GitHub qui exécute les tests. Sans cette liaison, un
          projet peut être créé mais aucune exécution ne peut démarrer.
        </p>
      </div>

      {isDemo ? (
        <div className="td-card-surface td-settings-note">
          <Icon name="lock" className="td-ic-16" />
          <span>La démonstration est en lecture seule : aucune intégration ne peut être modifiée.</span>
        </div>
      ) : null}

      {githubError ? (
        <div className="td-card-surface td-settings-note is-error">
          <Icon name="triangle-alert" className="td-ic-16" />
          <span>{githubError}</span>
        </div>
      ) : null}

      <form className="td-card-surface td-settings-card" onSubmit={submit}>
        <div className="td-settings-head">
          <div>
            <h2>Intégration GitHub</h2>
            <p>
              La clé privée de la GitHub App reste dans les secrets Supabase. Seuls le dépôt, le
              workflow et l’installation sont enregistrés ici.
            </p>
          </div>
          <span className={'td-settings-badge' + (connected ? ' is-on' : '')}>
            <span className="td-settings-dot" />
            {githubLoading ? 'Vérification…' : connected ? 'Connecté' : 'Non configuré'}
          </span>
        </div>

        <div className="td-settings-grid">
          <div className="td-field">
            <label className="td-field-label" htmlFor="gh-repo">
              Dépôt GitHub <span className="td-req">*</span>
            </label>
            <input
              id="gh-repo"
              className="td-control"
              placeholder="owner/repo"
              value={form.repoFullName}
              onChange={set('repoFullName')}
              disabled={!canEdit || saving}
              autoComplete="off"
            />
            <p className="td-field-hint">Exemple : jinshiagencys-byte/BOG</p>
          </div>

          <div className="td-field">
            <label className="td-field-label" htmlFor="gh-installation">
              Installation ID <span className="td-req">*</span>
            </label>
            <input
              id="gh-installation"
              className="td-control"
              inputMode="numeric"
              placeholder="174244878"
              value={form.installationId}
              onChange={set('installationId')}
              disabled={!canEdit || saving}
              autoComplete="off"
            />
            <p className="td-field-hint">Identifiant numérique de la GitHub App installée.</p>
          </div>

          <div className="td-field">
            <label className="td-field-label" htmlFor="gh-workflow">
              Fichier de workflow
            </label>
            <input
              id="gh-workflow"
              className="td-control"
              placeholder="antigravity-qa.yml"
              value={form.workflowFile}
              onChange={set('workflowFile')}
              disabled={!canEdit || saving}
              autoComplete="off"
            />
          </div>

          <div className="td-field">
            <label className="td-field-label" htmlFor="gh-branch">
              Branche par défaut
            </label>
            <input
              id="gh-branch"
              className="td-control"
              placeholder="main"
              value={form.defaultBranch}
              onChange={set('defaultBranch')}
              disabled={!canEdit || saving}
              autoComplete="off"
            />
          </div>
        </div>

        <label className="td-settings-check">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={set('isActive')}
            disabled={!canEdit || saving}
          />
          <span>Activer cette intégration pour les exécutions</span>
        </label>

        {error ? (
          <p className="td-settings-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="td-settings-actions">
          {githubIntegration ? (
            <button
              type="button"
              className="td-btn td-btn-ghost td-btn-danger"
              onClick={remove}
              disabled={!canEdit || saving}
            >
              Supprimer
            </button>
          ) : null}
          <Link className="td-btn" to="/projects">
            Retour aux projets
          </Link>
          <button
            type="submit"
            className="td-btn td-btn-primary"
            disabled={!canEdit || saving}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer l’intégration'}
          </button>
        </div>
      </form>

      <div className="td-card-surface td-settings-help">
        <div className="td-settings-help-icon">
          <Icon name="workflow" className="td-ic-20" />
        </div>
        <div>
          <h3>Comment relier un projet</h3>
          <p>
            Un projet hérite de l’intégration GitHub de son organisation. Après avoir enregistré
            le dépôt et l’installation, ouvrez un projet, sélectionnez des cas de test puis cliquez
            sur « Lancer ». Le workflow GitHub est déclenché par une Edge Function ; le navigateur
            n’appelle jamais GitHub directement.
          </p>
        </div>
      </div>

      <Toast message={toast} tone={toastTone} onDone={() => setToast('')} />
    </>
  )
}
