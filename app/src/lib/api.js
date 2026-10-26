import { supabase } from './supabase.js'
import {
  mapCase,
  mapCaseResult,
  mapGithubIntegration,
  mapMembership,
  mapProject,
  mapProjectRpc,
  mapRun,
} from './mappers.js'

export class ApiError extends Error {
  constructor(message, code = 'API_ERROR', cause = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.cause = cause
  }
}

function toApiError(error) {
  if (error instanceof ApiError) return error
  const message = error?.message || String(error || 'Erreur inconnue')
  const code = error?.code ? String(error.code) : 'API_ERROR'
  return new ApiError(message, code, error)
}

const ERROR_MESSAGES = {
  AUTH_REQUIRED: 'Vous devez être connecté pour effectuer cette action.',
  AUTH_INVALID: 'Votre session a expiré. Reconnectez-vous.',
  ORG_FORBIDDEN: "Vous n'avez pas les droits nécessaires dans cette organisation.",
  ORG_NAME_REQUIRED: "Le nom de l'organisation est requis.",
  PROJECT_NAME_REQUIRED: 'Le nom du projet est requis.',
  CLIENT_NAME_REQUIRED: 'Le nom du client est requis.',
  PROJECT_URL_INVALID: "L'URL doit commencer par http:// ou https://.",
  FREQUENCY_INVALID: 'Les fréquences doivent être des nombres entiers positifs.',
  NO_CASE_TEMPLATES: 'Aucun pack de cas de test ne correspond à cette catégorie.',
  PROJECT_FIELDS_REQUIRED: 'Le nom du projet et le nom du client sont requis.',
  PROJECT_NOT_FOUND: 'Projet introuvable.',
  NO_ACTIVE_PLAN: "Ce projet n'a pas de plan de test actif.",
  NO_CASES_SELECTED: 'Sélectionnez au moins un cas de test.',
  CASE_NOT_IN_PLAN: "Un cas sélectionné n'appartient pas au plan actif.",
  CASES_REQUIRED: 'Sélectionnez au moins un cas de test.',
  SITE_NOT_FOUND: 'Projet introuvable.',
  SITE_ID_REQUIRED: 'Projet manquant.',
  GITHUB_NOT_CONFIGURED:
    "Cette organisation n'a pas d'intégration GitHub active. Configurez-la dans les paramètres de l'organisation.",
  GITHUB_INSTALLATION_MISSING:
    "L'installation de la GitHub App est manquante. Renseignez l'installation ID dans les paramètres.",
  GITHUB_DISPATCH_FAILED:
    "GitHub a refusé le déclenchement du workflow. Vérifiez le dépôt, le workflow et l'installation.",
  RUN_CREATE_FAILED: "Impossible de créer l'exécution.",
  START_RUN_FAILED: "Impossible de déclencher l'exécution.",
}

export function messageForError(error) {
  if (!error) return 'Une erreur est survenue.'
  const code = error.code || ''
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  const message = error.message || String(error)
  for (const [key, value] of Object.entries(ERROR_MESSAGES)) {
    if (message.includes(key)) return value
  }
  if (message.includes('duplicate key')) return 'Cette valeur existe déjà.'
  return message
}

/* -------------------------------------------------------------------------- */
/* Authentification                                                           */
/* -------------------------------------------------------------------------- */

export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw toApiError(error)
  return data
}

export async function signUpWithPassword({ email, password, fullName }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  })
  if (error) throw toApiError(error)
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw toApiError(error)
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/reset`,
  })
  if (error) throw toApiError(error)
}

export async function signInWithOAuth(provider) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  })
  if (error) throw toApiError(error)
  return data
}

/* -------------------------------------------------------------------------- */
/* Organisations                                                              */
/* -------------------------------------------------------------------------- */

export async function listMemberships(userId) {
  const { data, error } = await supabase
    .from('organization_members')
    .select('org_id, role, created_at, organizations(id,name,slug,plan,is_demo,created_at)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })

  if (error) throw toApiError(error)
  return (data || []).map(mapMembership).filter(Boolean)
}

export async function createOrganization(name, role = 'owner') {
  const { data, error } = await supabase.rpc('create_organization', {
    p_name: String(name || '').trim(),
    p_role: role,
  })
  if (error) throw toApiError(error)
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    plan: data.plan,
    isDemo: false,
    role: data.role || role,
    createdAt: data.createdAt,
  }
}

/* -------------------------------------------------------------------------- */
/* Projets (sites)                                                            */
/* -------------------------------------------------------------------------- */

const PROJECT_COLUMNS = [
  'id',
  'org_id',
  'name',
  'slug',
  'category',
  'description',
  'client_name',
  'site_url',
  'assignee',
  'is_active',
  'crawl_interval_minutes',
  'notification_interval_minutes',
  'last_crawl_status',
  'ssl_days_remaining',
  'ssl_valid_to',
  'load_time_ms',
  'last_crawled_at',
  'created_at',
  'updated_at',
].join(',')

export async function listProjects(orgId) {
  const { data, error } = await supabase
    .from('sites')
    .select(PROJECT_COLUMNS)
    .eq('org_id', orgId)
    .not('slug', 'is', null)
    .order('created_at', { ascending: true })

  if (error) throw toApiError(error)
  return (data || []).map(mapProject)
}

export async function getProjectBySlug(slug) {
  const { data, error } = await supabase
    .from('sites')
    .select(PROJECT_COLUMNS)
    .ilike('slug', slug)
    .not('org_id', 'is', null)
    .maybeSingle()

  if (error) throw toApiError(error)
  return data ? mapProject(data) : null
}

export async function getProjectById(siteId) {
  const { data, error } = await supabase
    .from('sites')
    .select(PROJECT_COLUMNS)
    .eq('id', siteId)
    .maybeSingle()

  if (error) throw toApiError(error)
  return data ? mapProject(data) : null
}

async function listActivePlans(siteIds) {
  if (!siteIds.length) return []
  const { data, error } = await supabase
    .from('test_plans')
    .select('id,site_id,version,status,site_type,playbook_coverage,created_at,updated_at')
    .in('site_id', siteIds)
    .eq('status', 'active')
    .order('version', { ascending: false })

  if (error) throw toApiError(error)
  return data || []
}

async function countCasesByPlan(planIds) {
  if (!planIds.length) return {}
  const { data, error } = await supabase
    .from('test_cases')
    .select('plan_id')
    .in('plan_id', planIds)

  if (error) throw toApiError(error)
  const counts = {}
  for (const row of data || []) {
    counts[row.plan_id] = (counts[row.plan_id] || 0) + 1
  }
  return counts
}

export async function listProjectsWithStats(orgId) {
  const projects = await listProjects(orgId)
  if (!projects.length) return []

  const plans = await listActivePlans(projects.map((project) => project.id))
  const counts = await countCasesByPlan(plans.map((plan) => plan.id))
  const planBySite = new Map(plans.map((plan) => [plan.site_id, plan]))

  return projects.map((project) => {
    const plan = planBySite.get(project.id) || null
    return {
      ...project,
      planId: plan?.id || null,
      planVersion: plan?.version ?? null,
      caseCount: plan ? counts[plan.id] || 0 : 0,
    }
  })
}

export async function createProjectWithCases(input) {
  const { data, error } = await supabase.rpc('create_project_with_cases', {
    p_org_id: input.orgId,
    p_name: input.name,
    p_client_name: input.clientName,
    p_site_url: input.url,
    p_category: input.category,
    p_description: input.description || null,
    p_assignee: input.assignee || null,
    p_frequency_hours: Number(input.frequency),
    p_notification_hours: Number(input.notificationFrequency),
  })

  if (error) throw toApiError(error)
  return {
    project: mapProjectRpc(data.project, input.orgId),
    planId: data.planId,
    caseCount: data.caseCount,
  }
}

export async function updateProject(siteId, input) {
  const { data, error } = await supabase.rpc('update_project', {
    p_site_id: siteId,
    p_name: input.name,
    p_client_name: input.clientName,
    p_site_url: input.url,
    p_category: input.category,
    p_description: input.description || null,
    p_assignee: input.assignee || null,
    p_frequency_hours: Number(input.frequency),
    p_notification_hours: Number(input.notificationFrequency),
  })

  if (error) throw toApiError(error)
  return mapProjectRpc(data.project)
}

export async function deleteProject(siteId) {
  const { error } = await supabase.rpc('delete_project', { p_site_id: siteId })
  if (error) throw toApiError(error)
}

/* -------------------------------------------------------------------------- */
/* Catalogue de cas                                                           */
/* -------------------------------------------------------------------------- */

export async function getActivePlan(siteId) {
  const { data, error } = await supabase
    .from('test_plans')
    .select('id,site_id,version,status,site_type,interactions_mode,budget,playbook_coverage,generated_at,created_at,updated_at')
    .eq('site_id', siteId)
    .eq('status', 'active')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw toApiError(error)
  return data
}

export async function getCatalog(siteId) {
  const plan = await getActivePlan(siteId)
  if (!plan) return { plan: null, cases: [] }

  const { data, error } = await supabase
    .from('test_cases')
    .select(
      'id,plan_id,code,position,title,suite,status,priority,tags,description,source,entry_url,coverage_status,preconditions,postconditions,observations,updated_at,test_steps(id,position,code,action,expected)',
    )
    .eq('plan_id', plan.id)
    .order('position', { ascending: true })

  if (error) throw toApiError(error)
  return { plan, cases: (data || []).map(mapCase) }
}

async function nextCasePosition(planId) {
  const { data, error } = await supabase
    .from('test_cases')
    .select('position')
    .eq('plan_id', planId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw toApiError(error)
  return (data?.position ?? -1) + 1
}

function incrementCode(code) {
  const match = String(code || '').match(/^(.*?)(\d+)$/)
  if (!match) return `${code || 'TC-GEN'}-2`
  return `${match[1]}${String(Number(match[2]) + 1).padStart(match[2].length, '0')}`
}

export async function createCase(planId, { code, title, suite, steps = [] }) {
  const position = await nextCasePosition(planId)
  let nextCode = code || 'TC-GEN-001'

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await supabase
      .from('test_cases')
      .insert({
        plan_id: planId,
        code: nextCode,
        position,
        title,
        suite: suite || 'Sans suite',
        status: 'active',
        priority: 'medium',
        tags: [],
        description: title,
        source: 'manual',
        preconditions: ['L’utilisateur est connecté au projet'],
        postconditions: 'Le parcours se déroule comme prévu.',
        observations: [],
      })
      .select(
        'id,plan_id,code,position,title,suite,status,priority,tags,description,source,entry_url,coverage_status,preconditions,postconditions,observations,updated_at',
      )
      .single()

    if (!error) {
      if (steps.length) await insertSteps(data.id, steps)
      return mapCase({ ...data, test_steps: [] })
    }

    if (error.code !== '23505') throw toApiError(error)
    nextCode = incrementCode(nextCode)
  }

  throw new ApiError(
    'Impossible de générer un code de cas de test unique.',
    'CASE_CODE_CONFLICT',
  )
}

export async function updateCase(caseId, patch) {
  const columns = {}
  const map = {
    title: 'title',
    description: 'description',
    status: 'status',
    priority: 'priority',
    suite: 'suite',
    position: 'position',
    tags: 'tags',
    preconditions: 'preconditions',
    postconditions: 'postconditions',
    entryUrl: 'entry_url',
    coverageStatus: 'coverage_status',
  }
  for (const [key, column] of Object.entries(map)) {
    if (patch[key] !== undefined) columns[column] = patch[key]
  }
  if (!Object.keys(columns).length) return null

  const { data, error } = await supabase
    .from('test_cases')
    .update(columns)
    .eq('id', caseId)
    .select(
      'id,plan_id,code,position,title,suite,status,priority,tags,description,source,entry_url,coverage_status,preconditions,postconditions,observations,updated_at,test_steps(id,position,code,action,expected)',
    )
    .single()

  if (error) throw toApiError(error)
  return mapCase(data)
}

export async function deleteCase(caseId) {
  const { error } = await supabase.from('test_cases').delete().eq('id', caseId)
  if (error) throw toApiError(error)
}

export async function renameSuite(planId, oldName, newName) {
  const { error } = await supabase
    .from('test_cases')
    .update({ suite: newName })
    .eq('plan_id', planId)
    .eq('suite', oldName)

  if (error) throw toApiError(error)
}

export async function deleteSuite(planId, suite) {
  const { error } = await supabase
    .from('test_cases')
    .delete()
    .eq('plan_id', planId)
    .eq('suite', suite)

  if (error) throw toApiError(error)
}

export async function moveCase(caseId, suite, position) {
  const { error } = await supabase
    .from('test_cases')
    .update({ suite, position })
    .eq('id', caseId)

  if (error) throw toApiError(error)
}

export async function insertSteps(caseId, steps) {
  if (!steps.length) return
  const rows = steps.map((step, index) => ({
    case_id: caseId,
    position: index + 1,
    code: step.code || `S${index + 1}`,
    action: step.action || '',
    expected: step.expected || '',
  }))
  const { error } = await supabase.from('test_steps').insert(rows)
  if (error) throw toApiError(error)
}

// Réconcilie les étapes d'un cas sans supprimer les lignes existantes :
// les `test_step_results` historiques référencent `test_steps.id`.
export async function syncCaseSteps(caseId, steps) {
  const { data: existing, error: existingError } = await supabase
    .from('test_steps')
    .select('id,position')
    .eq('case_id', caseId)
    .order('position', { ascending: true })

  if (existingError) throw toApiError(existingError)

  const keptIds = new Set(steps.filter((step) => step.id).map((step) => step.id))
  const removed = (existing || []).filter((step) => !keptIds.has(step.id))

  // On décale d'abord les positions existantes pour éviter la contrainte
  // unique (case_id, position) pendant les réordonnancements.
  for (const step of existing || []) {
    const { error } = await supabase
      .from('test_steps')
      .update({ position: 10000 + step.position })
      .eq('id', step.id)
    if (error) throw toApiError(error)
  }

  if (removed.length) {
    const { error } = await supabase
      .from('test_steps')
      .delete()
      .in('id', removed.map((step) => step.id))
    if (error) throw toApiError(error)
  }

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    const row = {
      position: index + 1,
      code: step.code || `S${index + 1}`,
      action: step.action || '',
      expected: step.expected || '',
    }
    if (step.id) {
      const { error } = await supabase.from('test_steps').update(row).eq('id', step.id)
      if (error) throw toApiError(error)
    } else {
      const { error } = await supabase
        .from('test_steps')
        .insert({ ...row, case_id: caseId })
      if (error) throw toApiError(error)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Exécutions                                                                 */
/* -------------------------------------------------------------------------- */

const RUN_COLUMNS = [
  'id',
  'site_id',
  'plan_id',
  'run_number',
  'status',
  'started_at',
  'finished_at',
  'duration_ms',
  'passed_count',
  'failed_count',
  'blocked_count',
  'skipped_count',
  'total_count',
  'branch',
  'environment',
  'ci_provider',
  'commit_sha',
  'commit_message',
  'author',
  'pr_number',
  'tags',
  'suite_label',
  'github_run_url',
  'github_run_id',
  'error_message',
  'trigger',
  'rerun_of',
  'updated_at',
].join(',')

export async function listRuns(siteId, { limit = 200 } = {}) {
  const { data, error } = await supabase
    .from('test_runs')
    .select(RUN_COLUMNS)
    .eq('site_id', siteId)
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) throw toApiError(error)
  return (data || []).map(mapRun)
}

export async function getRunResults(runId) {
  const { data, error } = await supabase
    .from('test_case_results')
    .select(
      `id,status,note,duration_ms,failure_message,stack_trace,severity,started_at,finished_at,artifacts,
       case:test_cases(
         id,code,title,suite,postconditions,preconditions,
         steps:test_steps(id,position,code,action,expected)
       )`,
    )
    .eq('run_id', runId)

  if (error) throw toApiError(error)

  const rows = data || []
  const resultIds = rows.map((row) => row.id)
  let stepResults = []
  if (resultIds.length) {
    const { data: stepRows, error: stepError } = await supabase
      .from('test_step_results')
      .select('case_result_id,step_id,status,actual,evidence_url,evidence,precondition')
      .in('case_result_id', resultIds)
    if (stepError) throw toApiError(stepError)
    stepResults = stepRows || []
  }

  return rows
    .map((row) =>
      mapCaseResult(
        row,
        stepResults.filter((step) => step.case_result_id === row.id),
      ),
    )
    .sort((a, b) => String(a.code).localeCompare(String(b.code), 'fr'))
}

export async function listAcknowledgedRunIds(userId) {
  const { data, error } = await supabase
    .from('run_acknowledgements')
    .select('run_id')
    .eq('user_id', userId)

  if (error) throw toApiError(error)
  return (data || []).map((row) => row.run_id)
}

export async function acknowledgeRun(runId, userId) {
  const { error } = await supabase.from('run_acknowledgements').upsert(
    { run_id: runId, user_id: userId },
    { onConflict: 'run_id,user_id', ignoreDuplicates: true },
  )
  if (error) throw toApiError(error)
}

export async function startRun(siteId, caseIds, options = {}) {
  const { data, error } = await supabase.functions.invoke('start-run', {
    body: { siteId, caseIds, ...options },
  })

  if (error) {
    let code = 'START_RUN_FAILED'
    let detail = error.message || 'Impossible de déclencher l’exécution.'
    try {
      const payload = await error.context?.json?.()
      if (payload?.error) code = payload.error
      if (payload?.detail) detail = payload.detail
    } catch {
      /* le corps n'est pas toujours du JSON */
    }
    throw new ApiError(detail, code, error)
  }

  return data
}

/* -------------------------------------------------------------------------- */
/* Intégration GitHub                                                         */
/* -------------------------------------------------------------------------- */

const GITHUB_COLUMNS =
  'id,org_id,repo_full_name,workflow_file,default_branch,installation_id,is_active,created_at,updated_at'

export async function getGithubIntegration(orgId, { activeOnly = true } = {}) {
  let query = supabase
    .from('github_integrations')
    .select(GITHUB_COLUMNS)
    .eq('org_id', orgId)

  if (activeOnly) query = query.eq('is_active', true)

  const { data, error } = await query
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw toApiError(error)
  return mapGithubIntegration(data)
}

export async function saveGithubIntegration(orgId, values, id = null) {
  const row = {
    org_id: orgId,
    repo_full_name: String(values.repoFullName || '').trim(),
    workflow_file: String(values.workflowFile || 'antigravity-qa.yml').trim(),
    default_branch: String(values.defaultBranch || 'main').trim(),
    installation_id: values.installationId ? Number(values.installationId) : null,
    is_active: values.isActive !== false,
  }

  let query
  if (id) {
    query = supabase.from('github_integrations').update(row).eq('id', id)
  } else {
    query = supabase.from('github_integrations').insert(row)
  }

  const { data, error } = await query.select(GITHUB_COLUMNS).single()
  if (error) throw toApiError(error)
  return mapGithubIntegration(data)
}

export async function deleteGithubIntegration(id) {
  const { error } = await supabase.from('github_integrations').delete().eq('id', id)
  if (error) throw toApiError(error)
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export async function getSite(siteId) {
  const { data, error } = await supabase
    .from('sites')
    .select(
      'id,site_url,is_active,last_crawl_status,ssl_days_remaining,ssl_valid_to,load_time_ms,last_crawled_at,created_at',
    )
    .eq('id', siteId)
    .maybeSingle()

  if (error) throw toApiError(error)
  return data
}

export async function listPages(siteId) {
  const { data, error } = await supabase
    .from('pages')
    .select(
      'id,site_id,url,name,is_active,last_status,last_response_time_ms,last_checked_at',
    )
    .eq('site_id', siteId)
    .order('url', { ascending: true })

  if (error) throw toApiError(error)
  return data || []
}

export async function listPageChecks(pageIds, cutoff) {
  if (!pageIds.length) return []
  const { data, error } = await supabase
    .from('page_checks')
    .select('page_id,status,response_time_ms,checked_at')
    .in('page_id', pageIds)
    .gte('checked_at', new Date(cutoff).toISOString())
    .order('checked_at', { ascending: true })
    .limit(5000)

  if (error) throw toApiError(error)
  return data || []
}
