// Page « Projects » de l'espace organisation (app.testdino.com/org_…/projects).
//
// Les projets réels viennent de `sites` (filtrés par organisation) et sont
// enrichis du plan actif et du nombre de cas. La démo reste un jeu statique
// totalement isolé : elle ne déclenche aucune requête Supabase.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import CreateProjectModal from '../components/CreateProjectModal.jsx'
import Toast from '../components/testcases/Toast.jsx'
import { CardsSkeleton } from '../components/Skeleton.jsx'
import { useApp } from '../app/app-context.js'
import { DEMO_PROJECT } from '../app/projects.js'
import { messageForError } from '../lib/api.js'

// Offre gratuite : 1 projet maximum (le plan TEAM de la démo en autorise 5).
const FREE_PROJECT_LIMIT = 1
const TEAM_PROJECT_LIMIT = 5

function ProjectMenu({ readOnly, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="td-card-menu-wrap" ref={ref}>
      <button
        className="td-card-menu"
        type="button"
        title="Actions du projet"
        aria-label="Actions du projet"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="project-card-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more-horizontal" className="td-ic-16" />
      </button>

      {open ? (
        <div className="td-menu td-menu-right" role="menu">
          <button
            type="button"
            role="menuitem"
            className="td-menu-item"
            disabled={readOnly}
            onClick={() => {
              setOpen(false)
              onEdit()
            }}
          >
            <Icon name="pencil" className="td-ic-16" />
            <span className="td-menu-name">Modifier</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="td-menu-item"
            disabled={readOnly}
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          >
            <Icon name="trash-2" className="td-ic-16" />
            <span className="td-menu-name">Supprimer</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default function ProjectsView() {
  const {
    activeOrg,
    projects,
    projectsLoading,
    projectsError,
    refreshProjects,
    createProject,
    updateProject,
    deleteProject,
    githubIntegration,
    membershipRole,
  } = useApp()

  const navigate = useNavigate()
  const [modal, setModal] = useState(null) // null | { project?: projet à éditer }
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState('')
  const [toastTone, setToastTone] = useState('success')

  const isDemoOrg = Boolean(activeOrg?.isDemo)
  const list = isDemoOrg ? [DEMO_PROJECT] : projects
  const limit = isDemoOrg
    ? TEAM_PROJECT_LIMIT
    : activeOrg?.plan === 'team'
      ? TEAM_PROJECT_LIMIT
      : FREE_PROJECT_LIMIT
  const atLimit = list.length >= limit
  const canManage = membershipRole === 'owner' || membershipRole === 'admin'
  const githubConnected = Boolean(
    githubIntegration?.isActive &&
      githubIntegration?.installationId &&
      githubIntegration?.repoFullName,
  )

  const notify = (message, tone = 'success') => {
    setToastTone(tone)
    setToast(message)
  }

  const create = async (values) => {
    setSubmitting(true)
    try {
      const result = await createProject(values)
      setModal(null)
      notify(
        `Projet créé — ${result.caseCount} cas de test générés côté serveur.`,
        'success',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const save = async (project, values) => {
    setSubmitting(true)
    try {
      await updateProject(project.id, values)
      setModal(null)
      notify('Projet mis à jour.')
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (project) => {
    if (
      !window.confirm(
        `Supprimer le projet « ${project.name} » ? Les cas de test et les exécutions associés seront supprimés.`,
      )
    ) {
      return
    }
    try {
      await deleteProject(project.id)
      notify('Projet supprimé.')
    } catch (error) {
      notify(messageForError(error), 'error')
    }
  }

  return (
    <>
      <div className="td-projects-head">
        <h1>Projets</h1>
        <span className={`td-plan-badge${activeOrg?.plan === 'team' || isDemoOrg ? ' is-team' : ''}`}>
          {activeOrg?.plan === 'team' || isDemoOrg ? 'Équipe' : 'Gratuit'}
        </span>
        <span className="td-head-sep" />
        <span className="td-projects-count" data-testid="projects-count-text">
          {list.length} sur {limit} projets utilisés
        </span>
      </div>

      {!isDemoOrg ? (
        <div
          className={'td-projects-banner' + (githubConnected ? ' is-ok' : ' is-warn')}
        >
          <Icon
            name={githubConnected ? 'check-circle-2' : 'triangle-alert'}
            className="td-ic-16"
          />
          <span>
            {githubConnected
              ? `GitHub connecté : ${githubIntegration.repoFullName} (${githubIntegration.defaultBranch}).`
              : 'Aucune intégration GitHub active : les projets peuvent être créés, mais les exécutions ne démarreront pas.'}
          </span>
          <Link to="/org-settings">
            {githubConnected ? 'Gérer' : 'Configurer'}
            <Icon name="arrow-right" className="td-ic-12" />
          </Link>
        </div>
      ) : null}

      {projectsError ? (
        <div className="td-card-surface td-settings-note is-error">
          <Icon name="triangle-alert" className="td-ic-16" />
          <span>{projectsError}</span>
          <button type="button" className="td-btn td-btn-ghost" onClick={refreshProjects}>
            Réessayer
          </button>
        </div>
      ) : null}

      {projectsLoading && !isDemoOrg ? (
        <CardsSkeleton count={Math.max(1, Math.min(limit, 3))} />
      ) : (
        <div className="td-projects-grid">
          {list.map((project) => (
            <div className="td-project-link" key={project.id || project.slug}>
              <Link
                className="td-project-card"
                to={`/${project.slug}/dashboard`}
                data-testid="project-card"
              >
                <div className="td-project-top">
                  <h3
                    className="td-project-name"
                    title={project.name}
                    data-testid="project-card-name"
                  >
                    {project.name}
                  </h3>
                </div>
                <p className="td-project-desc">{project.description || '\u00A0'}</p>
                {project.category ? (
                  <span className="td-project-cat" data-testid="project-card-category">
                    <Icon name="tag" className="td-ic-12" />
                    {project.category}
                  </span>
                ) : null}

                {!isDemoOrg ? (
                  <div className="td-project-meta">
                    <span className={githubConnected ? 'is-ok' : 'is-warn'}>
                      <Icon
                        name={githubConnected ? 'check-circle-2' : 'triangle-alert'}
                        className="td-ic-12"
                      />
                      {githubConnected ? 'GitHub connecté' : 'GitHub non configuré'}
                    </span>
                    <span>
                      <Icon name="clipboard-list" className="td-ic-12" />
                      {project.caseCount ?? 0} cas
                    </span>
                  </div>
                ) : null}

                <div className="td-project-foot">
                  <Icon name="calendar" className="td-ic-12" />
                  <span>
                    Créé le{' '}
                    {project.createdAt
                      ? new Date(project.createdAt).toLocaleDateString('fr-FR', {
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })
                      : '—'}
                  </span>
                </div>
              </Link>

              <ProjectMenu
                readOnly={isDemoOrg || !canManage}
                onEdit={() => setModal({ project })}
                onDelete={() => remove(project)}
              />
            </div>
          ))}

          {/* Carte en pointillés : création d'un projet (ou upsell si la limite est atteinte). */}
          <button
            className="td-project-ghost"
            type="button"
            data-testid="new-project-card"
            disabled={isDemoOrg || !canManage}
            onClick={() => (atLimit ? navigate('/billing') : setModal({}))}
          >
            <span className="td-ghost-plus">
              <Icon name="plus" className="td-ic-20" />
            </span>
            <span className="td-ghost-title">Nouveau projet</span>
            <span className="td-ghost-sub">
              {atLimit && !isDemoOrg ? (
                <>
                  Passer à une offre supérieure pour ajouter des projets
                  <Icon name="arrow-right" className="td-ic-12" />
                </>
              ) : isDemoOrg ? (
                'La démonstration est en lecture seule.'
                ) : !canManage ? (
                  'Seuls les propriétaires et administrateurs peuvent créer un projet.'
                ) : (
                  'Cliquez pour créer un projet et commencer à suivre vos tests.'
                )}
            </span>
          </button>
        </div>
      )}

      {modal ? (
        <CreateProjectModal
          project={modal.project}
          submitting={submitting}
          onClose={() => {
            if (!submitting) setModal(null)
          }}
          onSubmit={
            modal.project
              ? (values) => save(modal.project, values)
              : create
          }
        />
      ) : null}

      <Toast message={toast} tone={toastTone} onDone={() => setToast('')} />
    </>
  )
}
