// Page « Projects » de l'espace organisation (app.testdino.com/org_…/projects).
//
// C'est l'écran sur lequel on arrive après l'onboarding : les projets sont des
// cartes de 280 px côte à côte, suivies d'une carte en pointillés « Nouveau projet »
// (dont le sous-titre devient « Passer à une offre supérieure » quand la limite du
// plan est atteinte). L'organisation de démonstration est en lecture seule.
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import CreateProjectModal from '../components/CreateProjectModal.jsx'
import { useApp } from '../app/app-context.js'
import { DEMO_PROJECT, DEMO_PROJECT_SLUG, formatCreated, slugify } from '../app/projects.js'

// Offre gratuite : 1 projet maximum (le plan TEAM de la démo en autorise 5).
const FREE_PROJECT_LIMIT = 1
const TEAM_PROJECT_LIMIT = 5

function ProjectMenu({ readOnly, onEdit, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
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
        onClick={() => setOpen((o) => !o)}
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
  const { projects, currentOrg, addProject, updateProject, removeProject } = useApp()
  const [modal, setModal] = useState(null) // null | { project?: projet à éditer }
  const navigate = useNavigate()

  // Organisation de démo : sandbox en lecture seule, plan TEAM et 5 projets.
  const isDemoOrg = currentOrg === 'demo'
  const list = isDemoOrg ? [DEMO_PROJECT] : projects
  const limit = isDemoOrg ? TEAM_PROJECT_LIMIT : FREE_PROJECT_LIMIT
  const atLimit = list.length >= limit

  const create = (values) => {
    const { name } = values
    const base = slugify(name)
    let slug = base
    let n = 2
    // Le slug du projet de démo est réservé : il ne doit jamais être réutilisé
    // par un projet réel (sinon il hériterait des données d'exemple).
    while (slug === DEMO_PROJECT_SLUG || projects.some((p) => p.slug === slug)) {
      slug = `${base}-${n}`
      n += 1
    }
    addProject({
      slug,
      ...values,
      createdAt: new Date().toISOString(),
    })
    setModal(null)
  }

  const save = (project, values) => {
    updateProject(project.slug, values)
    setModal(null)
  }

  return (
    <>
      <div className="td-projects-head">
        <h1>Projets</h1>
        <span className={`td-plan-badge${isDemoOrg ? ' is-team' : ''}`}>
          {isDemoOrg ? 'Équipe' : 'Gratuit'}
        </span>
        <span className="td-head-sep" />
        <span className="td-projects-count" data-testid="projects-count-text">
          {list.length} sur {limit} projets utilisés
        </span>
      </div>

      <div className="td-projects-grid">
        {list.map((project) => (
          <div className="td-project-link" key={project.slug}>
            <Link
              className="td-project-card"
              to={`/${project.slug}/dashboard`}
              data-testid="project-card"
            >
              <div className="td-project-top">
                <h3 className="td-project-name" title={project.name} data-testid="project-card-name">
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
              <div className="td-project-foot">
                <Icon name="calendar" className="td-ic-12" />
                <span>Créé le {formatCreated(project.createdAt)}</span>
              </div>
            </Link>

            <ProjectMenu
              readOnly={isDemoOrg}
              onEdit={() => setModal({ project })}
              onDelete={() => removeProject(project.slug)}
            />
          </div>
        ))}

        {/* Carte en pointillés : création d'un projet (ou upsell si la limite est atteinte). */}
        <button
          className="td-project-ghost"
          type="button"
          data-testid="new-project-card"
          disabled={isDemoOrg}
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
            ) : (
              'Cliquez pour créer un projet et commencer à suivre vos tests.'
            )}
          </span>
        </button>
      </div>

      {modal ? (
        <CreateProjectModal
          project={modal.project}
          onClose={() => setModal(null)}
          onSubmit={modal.project ? (values) => save(modal.project, values) : create}
        />
      ) : null}
    </>
  )
}
