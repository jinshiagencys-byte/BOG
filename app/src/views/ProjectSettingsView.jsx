import { Link } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { PageSkeleton } from '../components/Skeleton.jsx'
import { useProject } from '../app/project-context.js'
import { useApp } from '../app/app-context.js'
import { formatCreated } from '../app/projects.js'

function Row({ label, value, hint }) {
  return (
    <div className="td-settings-row">
      <span className="td-settings-row-label">{label}</span>
      <span className="td-settings-row-value">
        {value || '—'}
        {hint ? <small>{hint}</small> : null}
      </span>
    </div>
  )
}

export default function ProjectSettingsView() {
  const { project, isDemo, loading, error } = useProject()
  const { githubIntegration, membershipRole, projects } = useApp()

  if (loading) return <PageSkeleton rows={4} />
  if (error) {
    return (
      <div className="td-card-surface td-settings-note is-error">
        <Icon name="triangle-alert" className="td-ic-16" />
        <span>{error}</span>
      </div>
    )
  }
  if (!project) return null

  const connected = Boolean(
    githubIntegration?.isActive &&
      githubIntegration?.installationId &&
      githubIntegration?.repoFullName,
  )
  const canManage = membershipRole === 'owner' || membershipRole === 'admin'
  const stats = projects.find((item) => item.id === project.id) || null

  return (
    <>
      <div className="td-page-head">
        <h1>Paramètres du projet</h1>
        <p>Informations du projet et état de la liaison utilisée pour les exécutions.</p>
      </div>

      <div className="td-settings-columns">
        <section className="td-card-surface td-settings-card">
          <div className="td-settings-head">
            <div>
              <h2>Projet</h2>
              <p>Ces champs sont définis à la création et modifiables depuis la page Projets.</p>
            </div>
            <span className="td-settings-badge is-on">
              <span className="td-settings-dot" />
              {project.isActive === false ? 'Inactif' : 'Actif'}
            </span>
          </div>

          <div className="td-settings-rows">
            <Row label="Nom" value={project.name} />
            <Row label="Client" value={project.clientName} />
            <Row label="Catégorie" value={project.category} />
            <Row label="URL" value={project.url} />
            <Row label="Responsable" value={project.assignee} />
            <Row
              label="Vérification"
              value={`Toutes les ${project.frequency} h`}
            />
            <Row
              label="Notification"
              value={`Toutes les ${project.notificationFrequency} h`}
            />
            <Row label="Créé le" value={formatCreated(project.createdAt)} />
            {stats?.caseCount != null ? (
              <Row label="Cas de test" value={`${stats.caseCount} cas`} />
            ) : null}
          </div>
        </section>

        <section className="td-card-surface td-settings-card">
          <div className="td-settings-head">
            <div>
              <h2>Liaison GitHub</h2>
              <p>
                L’intégration est portée par l’organisation. Tous ses projets utilisent le même
                dépôt et le même workflow.
              </p>
            </div>
            <span className={'td-settings-badge' + (connected ? ' is-on' : '')}>
              <span className="td-settings-dot" />
              {connected ? 'Connecté' : 'Non configuré'}
            </span>
          </div>

          {githubIntegration ? (
            <div className="td-settings-rows">
              <Row label="Dépôt" value={githubIntegration.repoFullName} />
              <Row label="Workflow" value={githubIntegration.workflowFile} />
              <Row label="Branche" value={githubIntegration.defaultBranch} />
              <Row
                label="Installation"
                value={
                  githubIntegration.installationId
                    ? String(githubIntegration.installationId)
                    : 'Non renseignée'
                }
              />
            </div>
          ) : (
            <p className="td-settings-empty">
              Aucune intégration GitHub n’est configurée pour cette organisation. Les exécutions
              ne pourront pas démarrer.
            </p>
          )}

          <div className="td-settings-actions">
            {isDemo ? (
              <span className="td-field-hint">La démonstration est en lecture seule.</span>
            ) : (
              <Link className="td-btn td-btn-primary" to="/org-settings">
                {canManage ? 'Gérer l’intégration GitHub' : 'Voir l’intégration GitHub'}
              </Link>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
