import { useEffect } from 'react'
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from './auth-context.js'
import { ProjectProvider } from './project-context.jsx'
import { DEMO_PROJECT_SLUG } from './projects.js'
import { FullPageLoader } from '../components/Skeleton.jsx'
import { supabase } from '../lib/supabase.js'

export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageLoader label="Vérification de la session…" />
  if (!session) {
    return <Navigate to="/auth" replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}

export function RequireOrg() {
  const { organizations, organizationsLoaded, organizationsLoading } = useAuth()

  if (organizationsLoading || !organizationsLoaded) {
    return <FullPageLoader label="Chargement de l’organisation…" />
  }
  if (!organizations.length) {
    return <Navigate to="/onboarding" replace />
  }
  return <Outlet />
}

export function RedirectIfAuthed({ children }) {
  const { session, loading } = useAuth()
  if (loading) return <FullPageLoader label="Chargement…" />
  if (session) return <Navigate to="/projects" replace />
  return children
}

// La démo est consultable sans compte ; un projet réel exige une session.
export function ProjectGate({ children }) {
  const { project } = useParams()
  const { session, loading } = useAuth()
  const location = useLocation()
  const isDemo = project === DEMO_PROJECT_SLUG

  if (loading && !isDemo) return <FullPageLoader label="Chargement du projet…" />
  if (!isDemo && !session) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />
  }

  return <ProjectProvider>{children}</ProjectProvider>
}

export function AuthCallback() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    // Un refus Google revient avec `?error=...` ou `#error=...` avant même
    // l'échange du code : on l'affiche sur l'écran de connexion.
    const query = new URLSearchParams(location.search)
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
    const oauthError =
      query.get('error_description') ||
      hash.get('error_description') ||
      query.get('error') ||
      hash.get('error')
    if (oauthError) {
      navigate('/auth', {
        replace: true,
        state: { authError: decodeURIComponent(oauthError) },
      })
      return undefined
    }

    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      navigate(data.session ? '/projects' : '/auth', { replace: true })
    })
    return () => {
      mounted = false
    }
  }, [location.hash, location.search, navigate])

  return <FullPageLoader label="Finalisation de la connexion…" />
}
