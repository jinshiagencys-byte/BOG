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
import {
  inviteOrganizationMember,
  listOrganizationTeam,
  messageForError,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  sendOrganizationInviteEmail,
  updateOrganizationMemberRole,
} from '../lib/api.js'
import { registerWebMcpTools, webMcpSupported } from '../lib/webmcp.js'

const ORG_PAGES = ['/projects', '/users', '/org-settings', '/analytics', '/billing']
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MANAGE_ROLES = ['owner', 'admin']
const ROLE_LABELS = { owner: 'propriétaire', admin: 'administrateur', member: 'membre' }

function json(value) {
  return JSON.stringify(value)
}

// Les mutations passent par une confirmation visible : un agent ne peut pas
// retirer un membre ou révoquer une invitation sans accord explicite.
function confirmAction(message) {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true
  return window.confirm(message)
}

function notifyTeamChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('bog:team-changed'))
  }
}

function requireManager(state) {
  if (!state.activeOrg) throw new Error('Aucune organisation active.')
  if (state.activeOrg.isDemo) {
    throw new Error('La démonstration est en lecture seule.')
  }
  if (!MANAGE_ROLES.includes(state.membershipRole)) {
    throw new Error('Votre rôle ne permet pas de gérer l’équipe.')
  }
  return state.activeOrg
}

async function findMember(state, email) {
  const org = requireManager(state)
  const target = String(email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(target)) throw new Error('Adresse email invalide.')

  const rows = await listOrganizationTeam(org.id)
  const member = rows.find(
    (row) => row.status === 'active' && String(row.email).toLowerCase() === target,
  )
  const invitation = rows.find(
    (row) => row.status === 'invited' && String(row.email).toLowerCase() === target,
  )
  return { org, target, member, invitation }
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
      {
        name: 'bog_invite_member',
        description:
          'Invite a person to the active organization by email, with the member or admin role. Sends the invitation email. Requires an owner or admin role and an explicit user confirmation.',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Email address to invite.' },
            role: {
              type: 'string',
              enum: ['member', 'admin'],
              description: 'Role granted when the invitation is accepted.',
            },
          },
          required: ['email'],
        },
        annotations: { readOnlyHint: false, consequentialHint: true },
        execute: async ({ email, role = 'member' }) => {
          const current = state.current
          const org = requireManager(current)
          const target = String(email || '').trim().toLowerCase()

          if (!EMAIL_RE.test(target)) throw new Error('Adresse email invalide.')
          if (!['member', 'admin'].includes(role)) throw new Error('Rôle invalide.')

          const label = ROLE_LABELS[role] || role
          if (!confirmAction(`Inviter ${target} en tant que ${label} ?`)) {
            return json({ cancelled: true })
          }

          try {
            const result = await inviteOrganizationMember(org.id, target, role)
            if (result?.status === 'already_member') {
              return json({ invited: false, reason: 'already_member', email: target })
            }

            let emailSent = false
            try {
              const mail = await sendOrganizationInviteEmail(org.id, target)
              emailSent = mail?.sent !== false
            } catch {
              emailSent = false
            }

            notifyTeamChanged()
            return json({ invited: true, email: target, role, emailSent })
          } catch (error) {
            throw new Error(messageForError(error))
          }
        },
      },
      {
        name: 'bog_update_member_role',
        description:
          'Change the role (owner, admin or member) of an active member, identified by email. Requires an owner or admin role and an explicit user confirmation.',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Email of the member to update.' },
            role: { type: 'string', enum: ['owner', 'admin', 'member'] },
          },
          required: ['email', 'role'],
        },
        annotations: { readOnlyHint: false, consequentialHint: true },
        execute: async ({ email, role }) => {
          const current = state.current
          if (!['owner', 'admin', 'member'].includes(role)) throw new Error('Rôle invalide.')

          const { org, target, member } = await findMember(current, email)
          if (!member) throw new Error(`Membre introuvable : ${target}.`)
          const label = ROLE_LABELS[role] || role
          if (!confirmAction(`Donner le rôle « ${label} » à ${target} ?`)) {
            return json({ cancelled: true })
          }

          try {
            await updateOrganizationMemberRole(org.id, member.userId, role)
            notifyTeamChanged()
            return json({ updated: true, email: target, role })
          } catch (error) {
            throw new Error(messageForError(error))
          }
        },
      },
      {
        name: 'bog_remove_member',
        description:
          'Remove an active member from the active organization, identified by email. Requires an owner or admin role and an explicit user confirmation.',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Email of the member to remove.' },
          },
          required: ['email'],
        },
        annotations: { readOnlyHint: false, consequentialHint: true },
        execute: async ({ email }) => {
          const current = state.current
          const { org, target, member } = await findMember(current, email)
          if (!member) throw new Error(`Membre introuvable : ${target}.`)
          if (
            !confirmAction(
              `Retirer ${target} de ${org.name} ? Cette personne perdra immédiatement l’accès.`,
            )
          ) {
            return json({ cancelled: true })
          }

          try {
            await removeOrganizationMember(org.id, member.userId)
            notifyTeamChanged()
            return json({ removed: true, email: target })
          } catch (error) {
            throw new Error(messageForError(error))
          }
        },
      },
      {
        name: 'bog_revoke_invitation',
        description:
          'Revoke a pending invitation of the active organization, identified by email. Requires an owner or admin role and an explicit user confirmation.',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Email of the pending invitation.' },
          },
          required: ['email'],
        },
        annotations: { readOnlyHint: false, consequentialHint: true },
        execute: async ({ email }) => {
          const current = state.current
          const { org, target, invitation } = await findMember(current, email)
          if (!invitation) throw new Error(`Invitation introuvable : ${target}.`)
          if (!confirmAction(`Révoquer l’invitation de ${target} ?`)) {
            return json({ cancelled: true })
          }

          try {
            await revokeOrganizationInvitation(org.id, target)
            notifyTeamChanged()
            return json({ revoked: true, email: target })
          } catch (error) {
            throw new Error(messageForError(error))
          }
        },
      },
    ])
  }, [])

  return null
}
