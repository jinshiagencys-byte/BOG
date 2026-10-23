import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AppCtx } from './app-context.js'
import { useAuth } from './auth-context.js'
import { DEMO_ORG_NAME, DEMO_PROJECT } from './projects.js'
import {
  createProjectWithCases,
  deleteProject as deleteProjectApi,
  getGithubIntegration,
  listProjectsWithStats,
  messageForError,
  updateProject as updateProjectApi,
} from '../lib/api.js'

const DEMO_ORG = {
  id: 'demo',
  name: DEMO_ORG_NAME,
  slug: 'demo',
  plan: 'team',
  isDemo: true,
  role: 'member',
  createdAt: DEMO_PROJECT.createdAt,
}

function readActiveOrgId() {
  try {
    return localStorage.getItem('td-active-org') || null
  } catch {
    return null
  }
}

export function AppProvider({ children }) {
  const { user, organizations, organizationsLoaded, organizationsLoading } = useAuth()
  const location = useLocation()
  // La démo ne consulte ni les projets ni l'intégration GitHub de l'organisation
  // réelle, même si une session est encore présente dans le navigateur.
  const isDemoRoute = location.pathname.startsWith('/DemoProject')

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
  const [runList, setRunList] = useState([])
  const [runAckVersion, setRunAckVersion] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Signale aux vues qu'un run vient d'être acquitté (depuis le tiroir) afin
  // qu'elles rafraîchissent leur état sans recharger toute la page.
  const markRunAcknowledged = useCallback(() => {
    setRunAckVersion((value) => value + 1)
  }, [])

  const [activeOrgId, setActiveOrgId] = useState(readActiveOrgId)

  const setActiveOrg = useCallback((id) => {
    const next = id || null
    setActiveOrgId(next)
    try {
      if (next) localStorage.setItem('td-active-org', next)
      else localStorage.removeItem('td-active-org')
    } catch {
      /* ignore */
    }
  }, [])

  // Si l'organisation mémorisée n'existe plus (ou si l'utilisateur vient de
  // créer son compte), on retombe sur la première organisation réelle.
  useEffect(() => {
    if (isDemoRoute || activeOrgId === 'demo') return
    // Pendant un rafraîchissement (par exemple juste après la création d'une
    // organisation), la liste courante peut ne pas encore contenir la nouvelle
    // organisation : ne pas écraser l'id actif tant que le chargement n'est pas fini.
    if (organizationsLoading || !organizationsLoaded) return
    if (!organizations.length) {
      if (activeOrgId) setActiveOrg(null)
      return
    }
    if (!organizations.some((org) => org.id === activeOrgId)) {
      setActiveOrg(organizations[0].id)
    }
  }, [
    activeOrgId,
    isDemoRoute,
    organizations,
    organizationsLoaded,
    organizationsLoading,
    setActiveOrg,
  ])

  const activeOrg = useMemo(() => {
    if (isDemoRoute || activeOrgId === 'demo') return DEMO_ORG
    return organizations.find((org) => org.id === activeOrgId) || organizations[0] || null
  }, [activeOrgId, isDemoRoute, organizations])

  const membershipRole = activeOrg?.role || null

  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState('')
  const projectsRequest = useRef(0)

  const refreshProjects = useCallback(async () => {
    if (!activeOrg || activeOrg.isDemo) {
      projectsRequest.current += 1
      setProjects([])
      setProjectsLoading(false)
      setProjectsError('')
      return []
    }

    const requestId = ++projectsRequest.current
    setProjectsLoading(true)
    setProjectsError('')
    try {
      const rows = await listProjectsWithStats(activeOrg.id)
      if (requestId === projectsRequest.current) setProjects(rows)
      return rows
    } catch (error) {
      if (requestId === projectsRequest.current) {
        setProjects([])
        setProjectsError(messageForError(error))
      }
      return []
    } finally {
      if (requestId === projectsRequest.current) setProjectsLoading(false)
    }
  }, [activeOrg])

  useEffect(() => {
    refreshProjects()
  }, [refreshProjects])

  const [githubIntegration, setGithubIntegration] = useState(null)
  const [githubLoading, setGithubLoading] = useState(false)
  const [githubError, setGithubError] = useState('')
  const githubRequest = useRef(0)

  const refreshGithubIntegration = useCallback(async () => {
    if (!activeOrg || activeOrg.isDemo) {
      githubRequest.current += 1
      setGithubIntegration(null)
      setGithubLoading(false)
      setGithubError('')
      return null
    }

    const requestId = ++githubRequest.current
    setGithubLoading(true)
    setGithubError('')
    try {
      const row = await getGithubIntegration(activeOrg.id, { activeOnly: false })
      if (requestId === githubRequest.current) setGithubIntegration(row)
      return row
    } catch (error) {
      if (requestId === githubRequest.current) {
        setGithubIntegration(null)
        setGithubError(messageForError(error))
      }
      return null
    } finally {
      if (requestId === githubRequest.current) setGithubLoading(false)
    }
  }, [activeOrg])

  useEffect(() => {
    refreshGithubIntegration()
  }, [refreshGithubIntegration])

  const createProject = useCallback(
    async (values) => {
      if (!activeOrg || activeOrg.isDemo) {
        throw new Error('Sélectionnez une organisation réelle avant de créer un projet.')
      }
      const result = await createProjectWithCases({ orgId: activeOrg.id, ...values })
      await refreshProjects()
      return result
    },
    [activeOrg, refreshProjects],
  )

  const updateProject = useCallback(
    async (siteId, values) => {
      const project = await updateProjectApi(siteId, values)
      await refreshProjects()
      return project
    },
    [refreshProjects],
  )

  const deleteProject = useCallback(
    async (siteId) => {
      await deleteProjectApi(siteId)
      await refreshProjects()
    },
    [refreshProjects],
  )

  // Compatibilité avec les composants qui utilisaient encore l'ancien couple
  // « own / demo » : la source de vérité est désormais `activeOrg`.
  const currentOrg = activeOrg?.isDemo ? 'demo' : 'own'
  const organization = activeOrg?.name || ''
  const setCurrentOrg = useCallback(
    (value) => {
      if (value === 'demo') setActiveOrg('demo')
      else setActiveOrg(organizations[0]?.id || null)
    },
    [organizations, setActiveOrg],
  )

  const openRun = useCallback((nextRun, list = null) => {
    setPaletteOpen(false)
    setRun(nextRun)
    if (Array.isArray(list)) setRunList(list)
  }, [])
  const closeRun = useCallback(() => setRun(null), [])

  useEffect(() => {
    setRun(null)
    setRunList([])
    setPaletteOpen(false)
  }, [user?.id])

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
      runList,
      setRunList,
      runAckVersion,
      markRunAcknowledged,
      openRun,
      closeRun,
      paletteOpen,
      setPaletteOpen,
      organizations,
      activeOrg,
      activeOrgId,
      setActiveOrg,
      membershipRole,
      organization,
      currentOrg,
      setCurrentOrg,
      projects,
      projectsLoading,
      projectsError,
      refreshProjects,
      createProject,
      updateProject,
      deleteProject,
      githubIntegration,
      githubLoading,
      githubError,
      refreshGithubIntegration,
    }),
    [
      theme,
      toggleTheme,
      run,
      runList,
      setRunList,
      runAckVersion,
      markRunAcknowledged,
      openRun,
      closeRun,
      paletteOpen,
      organizations,
      activeOrg,
      activeOrgId,
      setActiveOrg,
      membershipRole,
      organization,
      currentOrg,
      setCurrentOrg,
      projects,
      projectsLoading,
      projectsError,
      refreshProjects,
      createProject,
      updateProject,
      deleteProject,
      githubIntegration,
      githubLoading,
      githubError,
      refreshGithubIntegration,
    ],
  )

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
