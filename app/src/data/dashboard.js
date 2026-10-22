/* ============================================================
   Dashboard — métriques réelles capturées sur la démo
   (« Last 30 days », projet project_4096f450529a50c5ca4613f9)

   NB : les 4 cartes KPI ne viennent plus de ce fichier mais de
   `data/sites.js` (sites surveillés, checks UP, temps de chargement,
   SSL à surveiller).

   La tendance Pass / Fail est dérivée de `data/runs.js` (résultats
   normalisés en deux statuts) pour rester cohérente avec le tableau
   des exécutions : mêmes compteurs, mêmes totaux.

   `branchSummary`, `flakyTests`, `degradingTests` et `chronicFailures`
   sont conservés car capturés sur le site réel, mais ne sont plus affichés :
   le Dashboard montre les runs récents (`data/runs.js`) à la place du
   « Branch Summary », et les trois cartes du bas ont été retirées.
   ============================================================ */

import { runs } from './runs.js'

export const branchSummary = [
  { branch: 'bhavy/organization', runs: 6, lastRun: '3 weeks 2 days ago', passRate: 0, status: 'failed', env: null },
  { branch: 'dhyey/testing', runs: 4, lastRun: '6 weeks 5 days ago', passRate: 0, status: 'failed', env: null },
  { branch: 'main', runs: 2, lastRun: '3 weeks 2 days ago', passRate: 0, status: 'failed', env: 'production' },
  { branch: 'bhavy/integration-test-fixes', runs: 1, lastRun: '3 weeks 2 days ago', passRate: 0, status: 'failed', env: null },
]

export const flakyTests = {
  count: 12,
  incidents: 19,
  window: '30d',
  items: [
    { title: 'verify API Keys section is visible and a API key can be created and deleted', file: 'project-settings.spec.ts', branch: 'main', env: 'production', flaky: 42.9 },
    { title: 'verify project settings heading, subheading and all section tabs are visible', file: 'project-settings.spec.ts', branch: 'main', env: 'production', flaky: 42.9 },
    { title: 'verify Branch Mapping tab is visible and a new environment can be created and saved', file: 'project-settings.spec.ts', branch: 'main', env: 'production', flaky: 28.6 },
    { title: 'verify Reports tab is visible and an automated report configuration can be created', file: 'project-settings.spec.ts', branch: 'main', env: 'production', flaky: 28.6 },
    { title: 'verify that user should be able to access the invoice page and should be able to see the invoices', file: 'organization/billing.spec.ts', branch: 'main', env: 'production', flaky: 14.3 },
    { title: 'verify that billing & usage option is visible after the login', file: 'organization/billing.spec.ts', branch: 'bhavy/organization', env: null, flaky: 14.3 },
    { title: 'verify that on the billing & usage page heading, overview, usage and invoices tab should be visible', file: 'organization/billing.spec.ts', branch: 'bhavy/integration-test-fixes', env: null, flaky: 14.3 },
    { title: 'card values match expected data patterns', file: 'organization/analytics.spec.ts', branch: 'bhavy/organization', env: null, flaky: 14.3 },
    { title: 'verify the user can create, rename, set as default and delete a custom view', file: 'insights/analysis.spec.ts', branch: 'main', env: 'production', flaky: 14.3 },
    { title: 'Verify that a custom field can be created and deleted successfully in Test Case Management.', file: 'test-case-management.spec.ts', branch: 'main', env: 'production', flaky: 14.3 },
    { title: 'verify that the Usage tab shows current usage for test cases, projects, users, the billing period', file: 'organization/billing.spec.ts', branch: 'main', env: 'production', flaky: 14.3 },
    { title: 'verify that user should be able to search the member by its name and see the member based on the role', file: 'organization/user-roles.spec.ts', branch: 'bhavy/organization', env: null, flaky: 14.3 },
  ],
}

export const degradingTests = {
  window: '30d',
  items: [
    { title: 'User A cart should not affect User B cart', file: 'part-1/cross-context.spec.ts', branch: 'main', env: 'production', delta: '+3.4s/run' },
    { title: 'Verify that a custom field can be created and deleted successfully in Test Case Management.', file: 'test-case-management.spec.ts', branch: 'main', env: 'production', delta: '+1.1s/run' },
    { title: 'verify that pull request all element should be visible when the repo is not connected', file: 'overview/pull-request.spec.ts', branch: 'bhavy/organization', env: null, delta: '+521ms/run' },
    { title: 'verify Branch Mapping tab is visible and a new environment can be created and saved', file: 'project-settings.spec.ts', branch: 'main', env: 'production', delta: '+439ms/run' },
    { title: 'verify that the Usage tab shows current usage for test cases, projects, users', file: 'organization/billing.spec.ts', branch: 'bhavy/organization', env: null, delta: '+354ms/run' },
    { title: 'verify that the Overview tab of the Billing & Usage page shows the plan name', file: 'organization/billing.spec.ts', branch: 'bhavy/organization', env: null, delta: '+303ms/run' },
    { title: 'verify that user should be able to search the member by its name', file: 'organization/user-roles.spec.ts', branch: 'bhavy/organization', env: null, delta: '+300ms/run' },
    { title: 'intentionally failing test', file: 'example.spec.js', branch: null, env: null, delta: '+276ms/run' },
    { title: 'User adds products and opens checkout flow', file: 'part-2/codegen-refactored.spec.ts', branch: 'main', env: 'production', delta: '+247ms/run' },
    { title: 'verify that the test run page all element renders successfully', file: 'explorer/test-run-details.spec.ts', branch: 'bhavy/organization', env: null, delta: '+233ms/run' },
  ],
}

export const chronicFailures = {
  window: '30d',
  items: [
    { title: 'verify project settings heading, subheading and all section tabs are visible', file: 'general/project-settings.spec.ts', branch: 'bhavy/organization', streak: 8 },
    { title: 'verify Branch Mapping tab is visible and a new environment can be created and saved', file: 'general/project-settings.spec.ts', branch: 'bhavy/organization', streak: 8 },
    { title: 'verify General tab shows project details, usage summary.', file: 'general/project-settings.spec.ts', branch: 'bhavy/organization', streak: 8 },
    { title: 'verify API Keys section is visible and a API key can be created and deleted', file: 'general/project-settings.spec.ts', branch: 'bhavy/organization', streak: 8 },
    { title: 'verify Reports tab is visible and an automated report configuration can be created', file: 'general/project-settings.spec.ts', branch: 'bhavy/organization', streak: 8 },
    { title: 'Verify that a release can be created, started, updated, and deleted successfully in Manual Testing.', file: 'management/test-case-management.spec.ts', branch: 'bhavy/organization', streak: 7 },
    { title: 'Verify that a manual test case can be copied, deleted, and its ID can be copied successfully', file: 'management/test-case-management.spec.ts', branch: 'bhavy/organization', streak: 7 },
    { title: 'Verify that user should be redirected to the Slack app', file: 'general/integration-tests.spec.ts', branch: 'bhavy/organization', streak: 7 },
    { title: 'Verify user is redirected to GitLab on Connect to GitLab', file: 'general/integration-tests.spec.ts', branch: 'bhavy/organization', streak: 7 },
    { title: 'Verify user is redirected to Asana on Connect to Asana', file: 'general/integration-tests.spec.ts', branch: 'bhavy/organization', streak: 7 },
  ],
}

/* Tendance Pass / Fail — 30 derniers runs, dans l'ordre chronologique.
   Les compteurs viennent de `runs.results` (mêmes valeurs que les badges
   et les totaux du tableau Test Runs), et non plus du snapshot brut
   `activity_sparkline` qui comptait différemment flaky/skipped/interrupted. */
export const passFailTrend = runs
  .filter((r) => r.counter >= 21)
  .slice()
  .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  .map((r) => ({ run: `#${r.counter}`, passed: r.results.passed, failed: r.results.failed }))
