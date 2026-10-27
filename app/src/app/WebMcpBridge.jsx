// Pont WebMCP de BOG.
//
// Monté une seule fois dans l’app, il déclare les outils que les agents du
// navigateur peuvent découvrir et exécuter. Les outils lisent l’état courant
// via une ref : pas de réenregistrement à chaque rendu.
//
// Rien n’est exposé si le navigateur ne fournit pas `document.modelContext`.
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from './app-context.js'
import { useAuth } from './auth-context.js'
import { listOrganizationTeam, messageForError } from '../lib/api.js'
import { registerWebMcpTools, webMcpSupported } from '../lib/webmcp.js'

const ORG_PAGES = ['/projects', '/users', '/org-settings', '/analytics', '/billing']

function json(value) {
  return JSON.stringify(value)
}

function projectSummary(project) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    category: project.category,
    url: project.url,
    active: project.isActive,
    lastCrawlStatus: project.lastCrawlStatus,
  }
}

export default function WebMcpBridge() {
  const { activeOrg, membershipRole, projects } = useApp()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const state = useRef({})
  useEffect(() => {
    state.current = {
      activeOrg,
      membershipRole,
      projects,
      userEmail: user?.email || null,
      pathname: location.pathname,
      navigate,
    }
  })

  useEffect(() => {
    if (!webMcpSupported()) return undefined

    return registerWebMcpTools([
      {
        name: 'bog_get_context',
        description:
          'Read the current BOG context: page path, signed-in user, active organization, role, demo mode and number of visible projects.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => {
          const current = state.current
          return json({
            path: current.pathname,
            user: current.userEmail,
            organization: current.activeOrg
              ? {
                  id: current.activeOrg.id,
                  name: current.activeOrg.name,
                  plan: current.activeOrg.plan,
                  demo: Boolean(current.activeOrg.isDemo),
                }
              : null,
            role: current.membershipRole,
            projectCount: current.projects.length,
          })
        },
      },
      {
        name: 'bog_list_projects',
        description:
          'List the projects of the active organization with their slug, category, URL and last crawl status.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => {
          const current = state.current
          return json({
            organization: current.activeOrg?.name || null,
            projects: current.projects.map(projectSummary),
          })
        },
      },
      {
        name: 'bog_open_project',
        description:
          'Open a project dashboard in BOG. Accepts the project slug or its display name.',
        inputSchema: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project slug (for example "DemoProject") or display name.',
            },
          },
          required: ['project'],
        },
        annotations: { readOnlyHint: false },
        execute: async ({ project }) => {
          const current = state.current
          const needle = String(project || '').trim().toLowerCase()
          if (!needle) throw new Error('Indiquez un projet à ouvrir.')

          const match = current.projects.find(
            (row) =>
              String(row.slug).toLowerCase() === needle ||
              String(row.name).toLowerCase() === needle,
          )
          if (!match) {
            throw new Error(
              `Projet introuvable : « ${project} ». Projets disponibles : ${current.projects
                .map((row) => row.name)
                .join(', ') || 'aucun'}.`,
            )
          }

          current.navigate(`/${match.slug}/dashboard`)
          return json({ opened: match.name, slug: match.slug, path: `/${match.slug}/dashboard` })
        },
      },
      {
        name: 'bog_open_page',
        description:
          'Navigate to a top-level BOG page of the organization workspace.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              enum: ORG_PAGES,
              description: 'Target page path.',
            },
          },
          required: ['path'],
        },
        annotations: { readOnlyHint: false },
        execute: async ({ path }) => {
          if (!ORG_PAGES.includes(path)) {
            throw new Error(`Page non autorisée : « ${path} ».`)
          }
          state.current.navigate(path)
          return json({ opened: path })
        },
      },
      {
        name: 'bog_list_team',
        description:
          'List the members and pending invitations of the active organization with their roles and status.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          const current = state.current
          if (!current.activeOrg) throw new Error('Aucune organisation active.')
          if (current.activeOrg.isDemo) {
            return json({
              demo: true,
              members: [],
              invitations: [],
              note: 'La démonstration est en lecture seule et ne consulte pas Supabase.',
            })
          }

          try {
            const rows = await listOrganizationTeam(current.activeOrg.id)
            return json({
              organization: current.activeOrg.name,
              members: rows
                .filter((row) => row.status === 'active')
                .map((row) => ({
                  name: row.fullName,
                  email: row.email,
                  role: row.role,
                  since: row.createdAt,
                })),
              invitations: rows
                .filter((row) => row.status === 'invited')
                .map((row) => ({
                  email: row.email,
                  role: row.role,
                  invitedAt: row.createdAt,
                })),
            })
          } catch (error) {
            throw new Error(messageForError(error))
          }
        },
      },
    ])
  }, [])

  return null
}
