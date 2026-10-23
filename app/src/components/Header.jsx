import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import Icon from './Icon.jsx'
import ChangelogBell from './ChangelogBell.jsx'
import { useApp } from '../app/app-context.js'
import { NAV_FLAT } from '../app/nav.js'
import {
  DEMO_ORG_NAME,
  DEMO_PROJECT,
  DEMO_PROJECT_SLUG,
  projectNameFor,
} from '../app/projects.js'

/* Sélecteur de projet du fil d'ariane : le nom du projet ouvre la liste des
   projets de l'organisation, et le changement conserve la page courante. */
function ProjectSwitcher({ project, projects, organization }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Page courante du projet : on la conserve d'un projet à l'autre.
  const suffix =
    NAV_FLAT.find((i) => location.pathname === `/${project}${i.to}`)?.to || '/dashboard'

  const go = (slug) => {
    setOpen(false)
    if (slug !== project) navigate(`/${slug}${suffix}`)
  }

  const currentName = projectNameFor(project, projects)
  const demoProjects = [{ slug: DEMO_PROJECT.slug, name: DEMO_PROJECT.name }]
  const ownProjects = projects.filter((p) => p.slug !== DEMO_PROJECT_SLUG)

  const option = (p) => (
    <button
      key={p.slug}
      type="button"
      className={'td-project-opt' + (p.slug === project ? ' is-active' : '')}
      aria-current={p.slug === project ? 'true' : undefined}
      onClick={() => go(p.slug)}
    >
      <Icon name="folder" className="td-ic-14" />
      <span>{p.name}</span>
      {p.slug === project ? <Icon name="check" className="td-ic-14" /> : null}
    </button>
  )

  return (
    <div className="td-project-switch" ref={ref}>
      <button
        type="button"
        className="td-project-pill"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Projet actuel : ${currentName}. Changer de projet`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="td-project-pill-name">{currentName}</span>
        <Icon name="chevron-down" className="td-ic-14" />
      </button>

      <div className={'td-pop td-project-pop' + (open ? ' is-open' : '')} role="menu">
        <div className="td-project-pop-inner">
          <div className="td-project-pop-section">{DEMO_ORG_NAME}</div>
          {demoProjects.map(option)}

          {ownProjects.length > 0 ? (
            <>
              <div className="td-project-pop-sep" />
              <div className="td-project-pop-section">{organization}</div>
              {ownProjects.map(option)}
            </>
          ) : null}

          <div className="td-project-pop-sep" />
          <Link
            to="/projects"
            className="td-project-opt td-project-opt-all"
            onClick={() => setOpen(false)}
          >
            <Icon name="layers" className="td-ic-14" />
            <span>Tous les projets</span>
            <Icon name="arrow-right" className="td-ic-14" />
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function Header({ onToggleSidebar }) {
  const { theme, toggleTheme, setPaletteOpen, projects, organization } = useApp()
  const { project } = useParams()
  const location = useLocation()
  const orgName = project === DEMO_PROJECT_SLUG ? DEMO_ORG_NAME : organization
  // Le fil d'ariane du vrai site est « <Projet> > <Page> ».
  const current = NAV_FLAT.find((i) => location.pathname === `/${project}${i.to}`)

  return (
    <header className="td-header">
      <button
        className="td-iconbtn"
        type="button"
        aria-label="Afficher ou masquer le menu latéral"
        onClick={onToggleSidebar}
      >
        <Icon name="panel-left" className="td-ic-16" />
      </button>
      <div className="td-header-sep" />

      <nav className="td-breadcrumb" aria-label="breadcrumb">
        <ProjectSwitcher project={project} projects={projects} organization={orgName} />
        <Icon name="chevron-right" className="td-ic-14" />
        <span className="td-breadcrumb-current">{current ? current.name : 'Dashboard'}</span>
      </nav>

      <div className="td-header-spacer" />

      <button
        className="td-search"
        type="button"
        aria-label="Rechercher"
        onClick={() => setPaletteOpen(true)}
      >
        <Icon name="search" className="td-ic-14" />
        <span>Rechercher dans TestDino...</span>
        <span className="td-kbd">Ctrl K</span>
      </button>

      <ChangelogBell />

      <button
        className="td-iconbtn"
        type="button"
        aria-label="Changer de thème"
        onClick={toggleTheme}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="td-ic-16" />
      </button>
    </header>
  )
}
