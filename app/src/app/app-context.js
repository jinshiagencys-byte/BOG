import { createContext, useContext } from 'react'

// Contexte partagé : thème, tiroir de run, palette de commandes.
export const AppCtx = createContext(null)

export function useApp() {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
