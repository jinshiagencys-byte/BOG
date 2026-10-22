import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppCtx } from './app-context.js'

export function AppProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try {
      const t = localStorage.getItem('td-theme')
      if (t) return t
    } catch {
      /* ignore */
    }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('td-theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  const [run, setRun] = useState(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Organisation créée par l'onboarding + projets de cette organisation.
  const [organization, setOrganization] = useState('Agencys Organization')
  // Organisation affichée par l'espace organisation : 'own' (celle de
  // l'onboarding, plan FREE) ou 'demo' (la sandbox en lecture seule, plan TEAM).
  const [currentOrg, setCurrentOrg] = useState(() => {
    try {
      return sessionStorage.getItem('td-org') === 'demo' ? 'demo' : 'own'
    } catch {
      return 'own'
    }
  })

  useEffect(() => {
    try {
      sessionStorage.setItem('td-org', currentOrg)
    } catch {
      /* sessionStorage indisponible : on ignore */
    }
  }, [currentOrg])

  // Les projets créés survivent à un rechargement (comme la session), mais
  // repartent de zéro dans un nouvel onglet — les données de démo restent statiques.
  const [projects, setProjects] = useState(() => {
    try {
      const raw = JSON.parse(sessionStorage.getItem('td-projects') || '[]')
      return Array.isArray(raw) ? raw : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      sessionStorage.setItem('td-projects', JSON.stringify(projects))
    } catch {
      /* sessionStorage indisponible : on ignore */
    }
  }, [projects])

  const addProject = useCallback(
    (project) => setProjects((list) => [...list, project]),
    [],
  )
  const updateProject = useCallback(
    (slug, patch) =>
      setProjects((list) => list.map((p) => (p.slug === slug ? { ...p, ...patch } : p))),
    [],
  )
  const removeProject = useCallback(
    (slug) => setProjects((list) => list.filter((p) => p.slug !== slug)),
    [],
  )

  const openRun = useCallback((r) => {
    setPaletteOpen(false)
    setRun(r)
  }, [])
  const closeRun = useCallback(() => setRun(null), [])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false)
        setRun(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      run,
      openRun,
      closeRun,
      paletteOpen,
      setPaletteOpen,
      organization,
      setOrganization,
      currentOrg,
      setCurrentOrg,
      projects,
      addProject,
      updateProject,
      removeProject,
    }),
    [
      theme,
      toggleTheme,
      run,
      openRun,
      closeRun,
      paletteOpen,
      organization,
      currentOrg,
      projects,
      addProject,
      updateProject,
      removeProject,
    ],
  )

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
