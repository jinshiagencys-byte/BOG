import { createContext, useContext } from 'react'

export const ProjectCtx = createContext(null)

export function useProject() {
  const ctx = useContext(ProjectCtx)
  if (!ctx) throw new Error('useProject must be used within ProjectProvider')
  return ctx
}
