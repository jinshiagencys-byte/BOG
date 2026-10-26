import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AuthCtx } from './auth-context.js'
import { supabase } from '../lib/supabase.js'
import {
  acceptMyInvitations,
  listMemberships,
  resetPassword as resetPasswordApi,
  signInWithOAuth,
  signInWithPassword,
  signOut as signOutApi,
  signUpWithPassword,
} from '../lib/api.js'

export function AuthProvider({ children }) {
  const location = useLocation()
  // La démo est entièrement statique : même connecté, ouvrir /DemoProject ne
  // doit charger aucune organisation depuis Supabase.
  const isDemoRoute = location.pathname.startsWith('/DemoProject')
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [organizations, setOrganizations] = useState([])
  const [organizationsLoading, setOrganizationsLoading] = useState(false)
  const [organizationsLoaded, setOrganizationsLoaded] = useState(false)
  const [organizationsError, setOrganizationsError] = useState('')

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return
      setSession(nextSession ?? null)
      setLoading(false)
      if (!nextSession) {
        setOrganizations([])
        setOrganizationsLoaded(true)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user?.id || null

  const refreshOrganizations = useCallback(async () => {
    if (!userId || isDemoRoute) {
      setOrganizations([])
      setOrganizationsLoading(false)
      setOrganizationsLoaded(true)
      setOrganizationsError('')
      return []
    }

    setOrganizationsLoading(true)
    setOrganizationsLoaded(false)
    setOrganizationsError('')
    try {
      // Les invitations en attente pour l'email du compte sont transformées en
      // adhésions avant de relire la liste des organisations.
      try {
        await acceptMyInvitations()
      } catch {
        /* une invitation non acceptée ne doit pas bloquer le chargement */
      }
      const rows = await listMemberships(userId)
      setOrganizations(rows)
      return rows
    } catch (error) {
      setOrganizations([])
      setOrganizationsError(error?.message || 'Impossible de charger les organisations.')
      return []
    } finally {
      setOrganizationsLoading(false)
      setOrganizationsLoaded(true)
    }
  }, [isDemoRoute, userId])

  useEffect(() => {
    // Ne pas marquer les organisations comme « chargées » avant que la session
    // initiale soit connue : sinon RequireOrg redirige brièvement vers
    // l'onboarding alors que l'utilisateur a déjà des organisations.
    if (loading || isDemoRoute) return
    refreshOrganizations()
  }, [isDemoRoute, loading, refreshOrganizations])

  const signIn = useCallback(
    (email, password) => signInWithPassword(String(email).trim(), password),
    [],
  )

  const signUp = useCallback(
    ({ email, password, fullName }) =>
      signUpWithPassword({ email: String(email).trim(), password, fullName: String(fullName).trim() }),
    [],
  )

  const signOut = useCallback(async () => {
    await signOutApi()
    setOrganizations([])
  }, [])

  const resetPassword = useCallback(
    (email) => resetPasswordApi(String(email).trim()),
    [],
  )

  const signInWithGoogle = useCallback(() => signInWithOAuth('google'), [])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      organizations,
      organizationsLoading,
      organizationsLoaded,
      organizationsError,
      refreshOrganizations,
      signIn,
      signUp,
      signOut,
      resetPassword,
      signInWithGoogle,
    }),
    [
      session,
      loading,
      organizations,
      organizationsLoading,
      organizationsLoaded,
      organizationsError,
      refreshOrganizations,
      signIn,
      signUp,
      signOut,
      resetPassword,
      signInWithGoogle,
    ],
  )

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
