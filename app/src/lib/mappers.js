// Normalisation des lignes Supabase (snake_case, colonnes brutes) vers les
// formes attendues par les composants de l'UI (camelCase, champs d'affichage).
//
// Règle importante : `id` reste TOUJOURS l'UUID de la base. Le code lisible
// (`TC-ECOM-001`) est exposé séparément dans `code` et ne doit jamais servir
// d'identifiant pour `start-run` ou les mutations.

export function mapMembership(row) {
  const org = row?.organizations
  if (!org) return null
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    plan: org.plan,
    isDemo: Boolean(org.is_demo),
    role: row.role,
    createdAt: org.created_at,
    joinedAt: row.created_at,
  }
}

export function mapProject(row) {
  if (!row) return null
  return {
    id: row.id,
    orgId: row.org_id,
    slug: row.slug,
    name: row.name,
    category: row.category || 'Autre',
    description: row.description || '',
    clientName: row.client_name || '',
    url: row.site_url || '',
    assignee: row.assignee || '',
    frequency: Math.max(1, Math.round((row.crawl_interval_minutes || 1440) / 60)),
    notificationFrequency: Math.max(
      1,
      Math.round((row.notification_interval_minutes || 720) / 60),
    ),
    isActive: row.is_active !== false,
    lastCrawlStatus: row.last_crawl_status || null,
    sslDaysRemaining: row.ssl_days_remaining ?? null,
    sslValidTo: row.ssl_valid_to || null,
    loadTimeMs: row.load_time_ms ?? null,
    lastCrawledAt: row.last_crawled_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  }
}

export function mapProjectRpc(project, orgId) {
  if (!project) return null
  return {
    id: project.id,
    orgId,
    slug: project.slug,
    name: project.name,
    category: project.category || 'Autre',
    description: project.description || '',
    clientName: project.clientName || '',
    url: project.url || '',
    assignee: project.assignee || '',
    frequency: Math.max(1, project.frequency || 24),
    notificationFrequency: Math.max(1, project.notificationFrequency || 12),
    isActive: true,
    createdAt: project.createdAt,
    updatedAt: project.createdAt,
  }
}

export function mapCase(row) {
  if (!row) return null
  const suite = row.suite || 'Sans suite'
  const steps = (row.test_steps || row.steps || [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((step) => ({
      id: step.id,
      position: step.position,
      code: step.code || '',
      action: step.action || '',
      expected: step.expected || '',
    }))

  return {
    id: row.id,
    code: row.code || row.id?.slice(0, 8) || '',
    planId: row.plan_id,
    position: row.position ?? 0,
    title: row.title || '',
    suite,
    suitePath: [suite],
    status: row.status || 'draft',
    priority: row.priority || 'medium',
    tags: Array.isArray(row.tags) ? row.tags : [],
    description: row.description || '',
    source: row.source || null,
    entryUrl: row.entry_url || null,
    coverageStatus: row.coverage_status || null,
    preconditions: Array.isArray(row.preconditions) ? row.preconditions : [],
    postconditions: row.postconditions || '',
    observations: row.observations || [],
    updatedAt: row.updated_at || null,
    steps,
  }
}

export function mapRun(row) {
  if (!row) return null
  const passed = Number(row.passed_count || 0)
  const failed = Number(row.failed_count || 0)
  const blocked = Number(row.blocked_count || 0)
  const skipped = Number(row.skipped_count || 0)
  const total = Number(row.total_count || passed + failed + blocked + skipped)
  // Un run qui vient d'être créé peut être `queued`/`pending` le temps que
  // GitHub démarre le workflow : il ne doit pas apparaître comme échoué.
  const runningStatuses = [
    'queued',
    'pending',
    'requested',
    'waiting',
    'in_progress',
    'running',
  ]
  const status =
    row.status === 'passed'
      ? 'passed'
      : runningStatuses.includes(row.status)
        ? 'running'
        : 'failed'

  return {
    id: row.id,
    siteId: row.site_id,
    planId: row.plan_id,
    counter: row.run_number ?? String(row.id).slice(0, 8),
    status,
    dbStatus: row.status,
    durationMs: row.duration_ms ?? null,
    startTime: row.started_at,
    finishedAt: row.finished_at || null,
    total,
    results: { passed, failed: failed + blocked + skipped },
    passedCount: passed,
    failedCount: failed,
    blockedCount: blocked,
    skippedCount: skipped,
    suite: row.suite_label || '—',
    branch: row.branch || null,
    env: row.environment || null,
    ci: row.ci_provider || 'github-actions',
    commitMessage: row.commit_message || null,
    commitHash: row.commit_sha || null,
    author: row.author || null,
    pr: row.pr_number ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    githubRunUrl: row.github_run_url || null,
    errorMessage: row.error_message || null,
    trigger: row.trigger || null,
    rerunOf: row.rerun_of || null,
    isDemo: false,
  }
}

export function mapCaseResult(row, stepResults = []) {
  const testCase = row.case || {}
  const steps = (testCase.steps || [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((step) => {
      const result = stepResults.find((item) => item.step_id === step.id)
      return {
        id: step.id,
        position: step.position,
        code: step.code || '',
        action: step.action || '',
        expected: step.expected || '',
        actual: result?.actual || '',
        status: result?.status || null,
        evidenceUrl: result?.evidence_url || null,
        evidence: result?.evidence || null,
        precondition: result?.precondition || null,
      }
    })

  return {
    id: row.id,
    code: testCase.code || row.case_id,
    title: testCase.title || 'Cas de test supprimé',
    suite: testCase.suite || null,
    status: row.status,
    failed: row.status !== 'passed',
    note: row.note || '',
    durationMs: row.duration_ms ?? null,
    failureMessage: row.failure_message || '',
    stackTrace: row.stack_trace || '',
    severity: row.severity || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    artifacts: row.artifacts || [],
    postconditions: testCase.postconditions || '',
    preconditions: testCase.preconditions || [],
    steps,
  }
}

export function mapGithubIntegration(row) {
  if (!row) return null
  return {
    id: row.id,
    orgId: row.org_id,
    repoFullName: row.repo_full_name,
    workflowFile: row.workflow_file || 'antigravity-qa.yml',
    defaultBranch: row.default_branch || 'main',
    installationId: row.installation_id ?? null,
    isActive: row.is_active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  }
}

export function deriveSuites(cases) {
  const counts = new Map()
  for (const item of cases) {
    const suite = item.suite || 'Sans suite'
    counts.set(suite, (counts.get(suite) || 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'fr'))
    .map(([name, count]) => ({ id: name, name, count, children: [] }))
}
