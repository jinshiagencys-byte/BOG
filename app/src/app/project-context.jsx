import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ProjectCtx } from './project-context.js'
import { useApp } from './app-context.js'
import { useAuth } from './auth-context.js'
import { DEMO_PROJECT, DEMO_PROJECT_SLUG } from './projects.js'
import { getProjectBySlug, messageForError } from '../lib/api.js'

export function ProjectProvider({ children }) {
  const { project: slug } = useParams()
  const { projects, activeOrgId, setActiveOrg } = useApp()
  const { session } = useAuth()
  const isDemo = slug === DEMO_PROJECT_SLUG

  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (isDemo) {
      setProject({ ...DEMO_PROJECT, id: 'demo', orgId: 'demo', isDemo: true })
      setLoading(false)
      setError('')
      return
    }

    if (!session) {
      setProject(null)
      setLoading(false)
      setError('')
      return
    }

    const cached = projects.find(
      (item) => String(item.slug).toLowerCase() === String(slug).toLowerCase(),
    )
    if (cached) {
      setProject(cached)
      setLoading(false)
      setError('')
      if (cached.orgId && cached.orgId !== activeOrgId) setActiveOrg(cached.orgId)
      return
    }

    setLoading(true)
    setError('')
    try {
      const row = await getProjectBySlug(slug)
      if (!row) {
        setProject(null)
        setError('Projet introuvable ou inaccessible.')
      } else {
        setProject(row)
        if (row.orgId && row.orgId !== activeOrgId) setActiveOrg(row.orgId)
      }
    } catch (loadError) {
      setProject(null)
      setError(messageForError(loadError))
    } finally {
      setLoading(false)
    }
  }, [isDemo, slug, session, projects, activeOrgId, setActiveOrg])

  useEffect(() => {
    load()
  }, [load])

  const value = useMemo(
    () => ({ project, isDemo, loading, error, refresh: load }),
    [project, isDemo, loading, error, load],
  )

  return <ProjectCtx.Provider value={value}>{children}</ProjectCtx.Provider>
}
