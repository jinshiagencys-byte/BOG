/* ============================================================
   Test Cases — arbre de suites réel capturé sur la démo
   (Total : 431 cas ; répartition identique au dashboard réel)
   ============================================================ */

export const TOTAL_CASES = 431
export const COVERAGE = { automated: 1, total: 431 }

const suiteTree = [
  {
    id: 's_mcp',
    name: 'MCP smoke 2026-09-16',
    count: 1,
    children: [],
  },
  {
    id: 's_pr',
    name: 'Pull Requests',
    count: 1,
    children: [{ id: 's_pr_gh', name: 'GitHub Integration', count: 1, children: [] }],
  },
  {
    id: 's_explorer',
    name: 'Test Explorer',
    count: 12,
    children: [
      { id: 's_explorer_details', name: 'Test Run Details', count: 7, children: [] },
      { id: 's_explorer_filters', name: 'Filters & Search', count: 5, children: [] },
    ],
  },
  {
    id: 's_cases',
    name: 'Test Cases',
    count: 59,
    children: [
      { id: 's_cases_mgmt', name: 'Test Case Management', count: 31, children: [] },
      { id: 's_cases_bulk', name: 'Bulk Actions', count: 14, children: [] },
      { id: 's_cases_manual', name: 'Manual Testing', count: 14, children: [] },
    ],
  },
  {
    id: 's_runs',
    name: 'Test Runs',
    count: 54,
    children: [
      { id: 's_runs_details', name: 'Run Details', count: 22, children: [] },
      { id: 's_runs_artifacts', name: 'Artifacts', count: 13, children: [] },
      { id: 's_runs_tags', name: 'Tags', count: 10, children: [] },
      { id: 's_runs_rerun', name: 'Re-run', count: 9, children: [] },
    ],
  },
  {
    id: 's_ai',
    name: 'AI Insights',
    count: 29,
    children: [
      { id: 's_ai_analysis', name: 'Analysis', count: 18, children: [] },
      { id: 's_ai_categories', name: 'Categories', count: 11, children: [] },
    ],
  },
  {
    id: 's_analytics',
    name: 'Analytics',
    count: 8,
    children: [
      { id: 's_analytics_overview', name: 'Overview', count: 2, children: [] },
      { id: 's_analytics_charts', name: 'Charts', count: 3, children: [] },
      { id: 's_analytics_export', name: 'Export', count: 2, children: [] },
      { id: 's_analytics_filters', name: 'Filters', count: 1, children: [] },
    ],
  },
  {
    id: 's_auth',
    name: 'Authentication',
    count: 19,
    children: [
      { id: 's_auth_login', name: 'Login', count: 4, children: [] },
      { id: 's_auth_signup', name: 'Sign Up', count: 6, children: [] },
      { id: 's_auth_recovery', name: 'Password Recovery', count: 4, children: [] },
      { id: 's_auth_oauth', name: 'Google OAuth', count: 2, children: [] },
      { id: 's_auth_logout', name: 'Logout', count: 2, children: [] },
    ],
  },
  { id: 's_checkout', name: 'Checkout', count: 3, children: [] },
  { id: 's_dashboard', name: 'Dashboard', count: 15, children: [] },
  {
    id: 's_settings',
    name: 'Settings',
    count: 135,
    children: [
      { id: 's_settings_general', name: 'General', count: 20, children: [] },
      { id: 's_settings_integrations', name: 'Integrations', count: 25, children: [] },
      { id: 's_settings_reports', name: 'Reports', count: 18, children: [] },
      { id: 's_settings_apikeys', name: 'API Keys', count: 16, children: [] },
      { id: 's_settings_branchmap', name: 'Branch Mapping', count: 14, children: [] },
      { id: 's_settings_notifications', name: 'Notifications', count: 22, children: [] },
      { id: 's_settings_access', name: 'Access', count: 20, children: [] },
    ],
  },
  {
    id: 's_orgmgmt',
    name: 'Organization Management',
    count: 57,
    children: [
      { id: 's_org_settings', name: 'Settings', count: 3, children: [] },
      {
        id: 's_org_setup',
        name: 'Organization Setup',
        count: 9,
        children: [
          { id: 's_org_create', name: 'Create Organization', count: 3, children: [] },
          { id: 's_org_update', name: 'Update Organization', count: 6, children: [] },
        ],
      },
      { id: 's_org_projects', name: 'Projects', count: 17, children: [] },
      { id: 's_org_users', name: 'Users & Roles', count: 18, children: [] },
      { id: 's_org_billing', name: 'Billing & Usage', count: 10, children: [] },
    ],
  },
  { id: 's_mcp_smoke', name: 'MCP-SMOKE-TEST Suite', count: 1, children: [] },
  { id: 's_payments', name: 'Payments', count: 3, children: [] },
  {
    id: 's_catalog',
    name: 'Product Catalog & Search',
    count: 7,
    children: [
      { id: 's_catalog_listing', name: 'Product Listing', count: 4, children: [] },
      { id: 's_catalog_search', name: 'Search', count: 3, children: [] },
    ],
  },
  { id: 's_visual', name: 'Visual UI & Media Verification', count: 5, children: [] },
  {
    id: 's_shopsphere',
    name: 'ShopSphere Web App',
    count: 22,
    children: [
      { id: 's_shop_cart', name: 'Cart', count: 9, children: [] },
      { id: 's_shop_checkout', name: 'Checkout Flow', count: 7, children: [] },
      { id: 's_shop_nav', name: 'Navigation', count: 6, children: [] },
    ],
  },
]

/* Un seul niveau de dossiers : pas de sous-dossiers. Les sous-suites sont
   fusionnées dans leur dossier parent (dont le compteur les inclut déjà). */
export const suites = suiteTree.map((s) => ({ ...s, children: [] }))

/* Cas de test — titres et fichiers issus de la démo réelle, répartis
   dans les suites ci-dessus. Format : [titre, suite, statut, priorité, tags, MAJ] */
const RAW_CASES = [
  ['verify API Keys section is visible and a API key can be created and deleted', 'Settings/API Keys', 'active', 'high', ['@ui'], '2026-09-24'],
  ['verify project settings heading, subheading and all section tabs are visible', 'Settings/General', 'active', 'high', ['@ui'], '2026-09-24'],
  ['verify Branch Mapping tab is visible and a new environment can be created and saved', 'Settings/Branch Mapping', 'active', 'medium', ['@ui'], '2026-09-24'],
  ['verify General tab shows project details, usage summary.', 'Settings/General', 'active', 'medium', ['@ui'], '2026-09-23'],
  ['verify Reports tab is visible and an automated report configuration can be created', 'Settings/Reports', 'active', 'medium', ['@ui'], '2026-09-23'],
  ['verify that user should be able to access the invoice page and should be able to see the invoices', 'Organization Management/Billing & Usage', 'active', 'high', ['@e2e'], '2026-09-24'],
  ['verify that billing & usage option is visible after the login', 'Organization Management/Billing & Usage', 'active', 'medium', ['@e2e'], '2026-09-22'],
  ['verify that on the billing & usage page heading, overview, usage and invoices tab should be visible', 'Organization Management/Billing & Usage', 'active', 'medium', ['@ui'], '2026-09-22'],
  ['card values match expected data patterns', 'Analytics/Overview', 'active', 'high', ['@api'], '2026-09-21'],
  ['card values match the analytics API response', 'Analytics/Overview', 'active', 'high', ['@api'], '2026-09-21'],
  ['verify the user can create, rename, set as default and delete a custom view', 'Analytics/Filters', 'active', 'medium', ['@e2e'], '2026-09-20'],
  ['verify the analytics export produces a CSV with the selected columns', 'Analytics/Export', 'draft', 'low', ['@api'], '2026-09-19'],
  ['User A cart should not affect User B cart', 'ShopSphere Web App/Cart', 'active', 'critical', ['@e2e'], '2026-09-24'],
  ['User adds products and opens checkout flow', 'ShopSphere Web App/Checkout Flow', 'active', 'high', ['@e2e'], '2026-09-24'],
  ['Verify that a custom field can be created and deleted successfully in Test Case Management.', 'Test Cases/Test Case Management', 'active', 'high', ['@e2e'], '2026-09-24'],
  ['Verify that a manual test case can be copied, deleted, and its ID can be copied successfully in Test Case Management.', 'Test Cases/Test Case Management', 'active', 'medium', ['@e2e'], '2026-09-23'],
  ['Verify that a release can be created, started, updated, and deleted successfully in Manual Testing.', 'Test Cases/Manual Testing', 'active', 'high', ['@e2e'], '2026-09-23'],
  ['verify that pull request all element should be visible it is when the repo is not connected', 'Pull Requests/GitHub Integration', 'active', 'medium', ['@ui'], '2026-09-24'],
  ['verify that the Usage tab shows current usage for test cases, projects, users, the billing period and usage by project', 'Organization Management/Billing & Usage', 'active', 'medium', ['@ui'], '2026-09-22'],
  ['verify that the Overview tab of the Billing & Usage page shows the plan name, test cases, projects and users', 'Organization Management/Billing & Usage', 'active', 'medium', ['@ui'], '2026-09-22'],
  ['verify that user should be able to search the member by its name and see the member based on the role', 'Organization Management/Users & Roles', 'active', 'high', ['@e2e'], '2026-09-23'],
  ['verify an organization can be created with name, slug and default project', 'Organization Management/Organization Setup/Create Organization', 'active', 'high', ['@e2e'], '2026-09-18'],
  ['verify organization settings can be updated and persisted', 'Organization Management/Organization Setup/Update Organization', 'active', 'medium', ['@e2e'], '2026-09-18'],
  ['verify a project can be created, renamed and deleted', 'Organization Management/Projects', 'active', 'medium', ['@e2e'], '2026-09-19'],
  ['verify a member can be invited and their role changed', 'Organization Management/Users & Roles', 'active', 'high', ['@e2e'], '2026-09-20'],
  ['intentionally failing test', 'Test Runs/Run Details', 'active', 'low', [], '2026-09-24'],
  ['verify that the test run page all element renders successfully', 'Test Explorer/Test Run Details', 'active', 'medium', ['@ui'], '2026-09-24'],
  ['verify the run list can be filtered by status and branch', 'Test Explorer/Filters & Search', 'active', 'medium', ['@e2e'], '2026-09-21'],
  ['verify a test run can be re-run from the run details page', 'Test Runs/Re-run', 'active', 'high', ['@e2e'], '2026-09-22'],
  ['verify test run level tags can be attached via env var', 'Test Runs/Tags', 'active', 'medium', ['@api'], '2026-09-22'],
  ['verify trace artifacts are downloadable for a failed run', 'Test Runs/Artifacts', 'active', 'medium', ['@e2e'], '2026-09-20'],
  ['verify AI insights categories are shown for failed and flaky tests', 'AI Insights/Categories', 'active', 'medium', ['@ui'], '2026-09-23'],
  ['verify the AI analysis panel renders a summary per test', 'AI Insights/Analysis', 'draft', 'low', ['@ui'], '2026-09-17'],
  ['verify login with valid credentials redirects to the dashboard', 'Authentication/Login', 'active', 'critical', ['@auth', '@e2e'], '2026-09-15'],
  ['verify sign up validation for email and password length', 'Authentication/Sign Up', 'active', 'high', ['@auth'], '2026-09-15'],
  ['verify password recovery email is sent and link works', 'Authentication/Password Recovery', 'active', 'high', ['@auth'], '2026-09-16'],
  ['verify Google OAuth login creates a session', 'Authentication/Google OAuth', 'active', 'medium', ['@auth'], '2026-09-16'],
  ['verify logout clears the session and redirects to login', 'Authentication/Logout', 'active', 'medium', ['@auth'], '2026-09-17'],
  ['verify the dashboard KPI cards display tracked tests and pass rate', 'Dashboard', 'active', 'high', ['@ui'], '2026-09-24'],
  ['verify the pass/fail trend chart renders the last runs', 'Dashboard', 'active', 'medium', ['@ui'], '2026-09-24'],
  ['verify the branch summary lists branches with last run and pass rate', 'Dashboard', 'active', 'medium', ['@ui'], '2026-09-23'],
  ['verify a product can be added to the catalog and appears in listing', 'Product Catalog & Search/Product Listing', 'active', 'medium', ['@e2e'], '2026-09-19'],
  ['verify search returns matching products for a partial query', 'Product Catalog & Search/Search', 'active', 'medium', ['@e2e'], '2026-09-19'],
  ['verify visual mismatches are reported with a diff image', 'Visual UI & Media Verification', 'active', 'high', ['@ui'], '2026-09-18'],
  ['verify a payment can be completed with a valid test card', 'Payments', 'active', 'critical', ['@e2e'], '2026-09-18'],
  ['verify checkout totals match the cart subtotal and tax', 'Checkout', 'active', 'high', ['@e2e'], '2026-09-18'],
  ['verify the MCP smoke test reaches the server and returns a tool list', 'MCP-SMOKE-TEST Suite', 'active', 'low', ['@api'], '2026-09-16'],
  ['verify the MCP smoke run for 2026-09-16 completes', 'MCP smoke 2026-09-16', 'active', 'low', ['@api'], '2026-09-16'],
]

/* Détails éditoriaux pour les cas emblématiques (description, pré/post-conditions,
   étapes). Les autres cas sont complétés automatiquement plus bas. */
const DETAILS = {
  'verify API Keys section is visible and a API key can be created and deleted': {
    description:
      'Verify that the API Keys section lists existing keys and that a new API key can be created, copied and revoked without leaving stale entries.',
    preconditions: ['User is an organization admin', 'User has access to at least one project'],
    postconditions: 'The new key is listed immediately and the revoked key can no longer authenticate.',
    steps: [
      { action: 'Open Settings → API Keys', expected: 'The API Keys section is visible and lists the existing keys.' },
      { action: 'Click "Create API key" and confirm the name', expected: 'A new key is generated and its value is shown once.' },
      { action: 'Copy the key value to the clipboard', expected: 'The full value can be pasted elsewhere without truncation.' },
      { action: 'Delete the key that was just created', expected: 'The key disappears from the list and is rejected by the API.' },
    ],
  },
  'verify that user should be able to access the invoice page and should be able to see the invoices': {
    description:
      'Verify that the invoices page is reachable from Billing & Usage and that each invoice exposes its period, amount and download action.',
    preconditions: ['User has an active paid plan', 'At least one invoice has already been issued'],
    postconditions: 'Invoices stay consistent with the usage reported on the Overview tab.',
    steps: [
      { action: 'Open Organization → Billing & Usage → Invoices', expected: 'The invoice list loads with period, amount and status.' },
      { action: 'Download an invoice as PDF', expected: 'The file downloads and matches the amounts shown in the list.' },
      { action: 'Switch billing period and re-check the list', expected: 'The list is filtered to the selected period.' },
    ],
  },
  'User A cart should not affect User B cart': {
    description:
      'Verify that two concurrent sessions keep isolated carts, both while items are added and after a reload.',
    preconditions: ['Two distinct user sessions are available', 'Both users have at least one product in view'],
    postconditions: 'No cart state is shared or overwritten between the two sessions.',
    steps: [
      { action: 'As user A, add a product to the cart', expected: 'The cart badge for user A increments.' },
      { action: 'As user B, open the cart page', expected: 'The cart of user B is unchanged by the action of user A.' },
      { action: 'Reload both sessions', expected: 'Each cart keeps only its own items.' },
    ],
  },
  'User adds products and opens checkout flow': {
    description: 'Verify that the checkout flow opens with the correct summary for the products added to the cart.',
    preconditions: ['User is signed in', 'Cart contains at least two products'],
    postconditions: 'Totals shown in checkout match the cart subtotal and the applied tax.',
    steps: [
      { action: 'Add two products to the cart', expected: 'The cart lists both products with quantity and price.' },
      { action: 'Click "Proceed to checkout"', expected: 'The checkout flow opens with the correct summary.' },
      { action: 'Compare the summary with the cart totals', expected: 'Subtotal, tax and total are identical.' },
    ],
  },
  'verify login with valid credentials redirects to the dashboard': {
    description: 'Verify that valid credentials create a session and route the user to the project dashboard.',
    preconditions: ['A registered account exists', 'The login page is reachable without a session'],
    postconditions: 'A session token is stored and protected routes are accessible.',
    steps: [
      { action: 'Open the login page', expected: 'The email and password fields are displayed.' },
      { action: 'Enter valid credentials and submit', expected: 'The user is redirected to the dashboard.' },
      { action: 'Refresh the page', expected: 'The session persists and the user stays signed in.' },
    ],
  },
  'verify a payment can be completed with a valid test card': {
    description: 'Verify that a payment with a valid test card succeeds and is recorded on the billing page.',
    preconditions: ['Sandbox payment provider is configured', 'A valid test card is available'],
    postconditions: 'The payment is recorded and the invoice reflects the new charge.',
    steps: [
      { action: 'Start a payment with a valid test card', expected: 'The payment form is accepted without validation error.' },
      { action: 'Confirm the payment', expected: 'A success message is displayed and the charge is created.' },
      { action: 'Open Billing & Usage → Invoices', expected: 'The new charge appears in the invoice list.' },
    ],
  },
}

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

const genericSteps = (leaf, title) => [
  { action: `Open the ${leaf} section`, expected: `The ${leaf} page loads and all of its elements are visible.` },
  { action: title, expected: 'The expected outcome is displayed and no error message appears.' },
  { action: 'Reload the page and repeat the flow', expected: 'The behaviour stays consistent and the state is persisted.' },
]

export const testCases = RAW_CASES.map((c, i) => {
  const [title, fullPath, status, priority, tags, updatedAt] = c
  const detail = DETAILS[title]
  // pas de sous-dossiers : chaque cas est rattaché à son dossier de premier niveau
  const suite = fullPath.split('/')[0]
  const leaf = fullPath.split('/').pop()
  const action = capitalize(title)
  return {
    id: 'TC-' + (412 - i),
    title,
    suite,
    suitePath: [suite],
    status,
    priority,
    tags,
    updatedAt,
    description: detail?.description || `Verify that ${title.replace(/^verify( that)?\s+/i, '')}.`,
    preconditions: detail?.preconditions || [
      'User is signed in to the project',
      `User has access to the ${leaf} section`,
    ],
    postconditions:
      detail?.postconditions ||
      `The ${leaf} section behaves as expected and no regression is detected on related flows.`,
    steps: detail?.steps || genericSteps(leaf, action),
  }
})

/* ---------- Helpers d'arborescence ---------- */

export function flattenSuites(list = suites, parentPath = '', depth = 0, out = []) {
  for (const s of list) {
    const path = parentPath ? `${parentPath}/${s.name}` : s.name
    out.push({ id: s.id, name: s.name, path, depth, count: s.count, node: s })
    flattenSuites(s.children || [], path, depth + 1, out)
  }
  return out
}

export const FLAT_SUITES = flattenSuites()

// Nombre « réel » de cas annoncé par la démo, indexé par chemin complet.
export const STATIC_COUNTS = FLAT_SUITES.reduce((acc, s) => {
  acc[s.path] = s.count
  return acc
}, {})

export const INITIAL_CASES = testCases

export const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }
export const STATUS_OPTIONS = ['active', 'draft', 'deprecated']
export const PRIORITY_OPTIONS = ['critical', 'high', 'medium', 'low']
export const STATUS_LABELS = { active: 'Active', draft: 'Draft', deprecated: 'Deprecated' }
