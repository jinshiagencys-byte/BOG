/* ============================================================
   Données réelles de la « Demo Organization » de TestDino.
   Capturées via analytics.testdino.com /api/v1/projects/{id}/runs
   ============================================================ */

const COLUMNS = [
  'counter', 'status', 'durationMs', 'startTime', 'passed', 'failed', 'flaky',
  'skipped', 'interrupted', 'unknown', 'total', 'branch', 'env', 'commitMessage',
  'commitHash', 'author', 'ci', 'pr', 'rerunOf', 'tags',
]

const BHAVY = 'bhavy207AB'
const DHYEY = 'Dhyey-chauhan'
const H_A9 = 'a95866244ae6b1e20bb84880feddb95687d9a051'
const H_CO = '600d201db97aa02d6980c74eda2e26032525d4c5'
const H_D2 = 'd205c0226df62dea7cf9f1d26aac2803ba570f3e'
const H_4D = '4d80a5546f37a43e6ba9a0cb5ef92bc089dab4e0'
const H_F1 = 'f1d9086ff05d3a48ca34d13ace5a69ee85b0c2b4'
const H_B8 = 'b82e9a22825f2bf860be48f29e68b75dba828189'
const H_68 = '68d59dce3b29532fdfd63584eb2fd97460df7cc7'
const H_69 = '6995bb6d59397ea22e116c74b4a02ab9f8aa358a'

const M_DEPS = 'chore(deps): update all packages to latest; bump CI Playwright image to 1.63.0'
const M_RERUN = 'ci: create auth session before installing @testdino/latest in rerun job'
const M_SPLIT = 'ci: split BOG re-run into a dedicated job (prod)'
const M_DISPATCH = 'ci: enable BOG re-run dispatch on the prod workflow'
const M_INTEG = 'test(integration): replace positional .first()/.last() locators with scoped chains'
const M_MERGE32 = 'Merge pull request #32 from testdino-hq/bhavy/integration-test-fixes'
const M_PIN = 'fix: pin @playwright/test to exact 1.59.1 to match CI container image'
const M_INIT = 'chore: initialize package.json for @testdino/playwright with dependencies, scripts, and metadata'
const M_ROLES = 'dhyey/user-roles'
const M_TAGS = 'feat: support test run level tags via TESTDINO_RUN_TAGS env var'
const M_MERGE1 = 'Merge pull request #1 from Dhyey-chauhan/dhyey/testing-PR\n\nDhyey/testing pr'
const M_VISUAL = 'chore: add visual mismatch detection tests for various scenarios'
const M_ONLY = 'test: remove test.only from project settings branch mapping test'
const M_TAGSPEC = 'test: add test run tag spec files for tag filter validation'
const M_MANUAL = 'feat: add manual testing option to IntegrationPage and update project settings tests for visibility checks'

const RAW = [
  [50, 'failed', 404692.459, '2026-09-24T09:13:45.465Z', 0, 5, 0, 0, 0, 0, 5, 'bhavy/organization', 'unmapped', M_DEPS, H_A9, BHAVY, 'github-actions', null, 49, []],
  [49, 'failed', 742346, '2026-09-24T07:06:51.282Z', 33, 17, 0, 0, 0, 0, 50, 'bhavy/organization', 'unmapped', M_DEPS, H_A9, BHAVY, 'github-actions', 33, null, []],
  [48, 'failed', 696702, '2026-09-24T07:00:43.595Z', 32, 17, 1, 0, 0, 0, 50, 'bhavy/organization', 'unmapped', M_RERUN, 'a0011bb3959cfb73f42b8905f953449e6245a8bf', BHAVY, 'github-actions', 33, null, []],
  [47, 'failed', 725920, '2026-09-24T06:56:48.148Z', 33, 17, 0, 0, 0, 0, 50, 'bhavy/organization', 'unmapped', M_SPLIT, '33202c1e1a1abb6245930c4ff272ba387e80828a', BHAVY, 'github-actions', 33, null, []],
  [46, 'failed', 709820, '2026-09-24T06:42:03.631Z', 33, 17, 0, 0, 0, 0, 50, 'bhavy/organization', 'unmapped', M_DISPATCH, H_CO, BHAVY, 'github-actions', null, null, []],
  [45, 'failed', 713897, '2026-09-24T06:41:30.835Z', 30, 18, 2, 0, 0, 0, 50, 'bhavy/organization', 'unmapped', M_DISPATCH, H_CO, BHAVY, 'github-actions', 33, null, []],
  [44, 'failed', 888496, '2026-09-24T05:10:58.736Z', 24, 24, 2, 0, 0, 0, 50, 'bhavy/integration-test-fixes', 'unmapped', M_INTEG, 'c9793718f8c9fb20089d8a99de9284a2f3c6f565', BHAVY, 'github-actions', null, null, []],
  [43, 'failed', 925155, '2026-09-24T05:08:24.974Z', 24, 24, 2, 0, 0, 0, 50, 'main', 'production', M_MERGE32, 'c3e4af9f3afd48ae8119fb38e8b1c7b5c918f057', BHAVY, 'github-actions', null, null, []],
  [42, 'incomplete', 946.595, '2026-08-31T13:32:19.594Z', 2, 2, 0, 1, 0, 0, 5, 'dhyey/testing', 'unmapped', M_PIN, H_D2, DHYEY, 'local', null, null, []],
  [41, 'failed', 1016.985, '2026-08-31T13:30:42.981Z', 2, 2, 0, 1, 0, 0, 5, 'dhyey/testing', 'unmapped', M_PIN, H_D2, DHYEY, 'local', null, null, []],
  [40, 'failed', 1018.193, '2026-08-31T13:28:34.126Z', 2, 2, 0, 1, 0, 0, 5, 'dhyey/testing', 'unmapped', M_PIN, H_D2, DHYEY, 'local', null, null, []],
  [39, 'incomplete', 937.97, '2026-08-31T13:27:13.32Z', 2, 2, 0, 1, 0, 0, 5, 'dhyey/testing', 'unmapped', M_PIN, H_D2, DHYEY, 'local', null, null, []],
  [38, 'failed', 907.977, '2026-08-31T09:58:54.882Z', 2, 2, 0, 1, 0, 0, 5, 'main', 'production', M_PIN, H_D2, DHYEY, 'local', null, null, []],
  [37, 'passed', 8380.08, '2026-08-27T15:21:13.765Z', 2, 0, 0, 0, 0, 0, 2, '', '', '', '', DHYEY, 'local', null, null, []],
  [36, 'passed', 16762.019, '2026-08-27T12:52:15.2Z', 2, 0, 0, 0, 0, 0, 2, '', '', '', '', DHYEY, 'local', null, null, []],
  [35, 'passed', 11273.947, '2026-08-27T12:52:43.875Z', 2, 0, 0, 0, 0, 0, 2, '', '', '', '', DHYEY, 'local', null, null, []],
  [34, 'passed', 7255.156, '2026-08-27T12:44:19.646Z', 2, 0, 0, 0, 0, 0, 2, '', '', '', '', DHYEY, 'local', null, null, []],
  [33, 'passed', 8654.069, '2026-08-27T12:41:11.968Z', 2, 0, 0, 0, 0, 0, 2, '', '', '', '', DHYEY, 'local', null, null, []],
  [32, 'passed', 10191.313, '2026-08-27T12:48:50.997Z', 2, 0, 0, 0, 0, 0, 2, '', '', '', '', DHYEY, 'local', null, null, []],
  [31, 'incomplete', 126012, '2026-08-27T12:50:02.321Z', 0, 0, 0, 0, 1, 1, 2, '', '', '', '', DHYEY, 'local', null, null, []],
  [30, 'passed', 9897.407, '2026-08-27T12:45:11.449Z', 2, 0, 0, 0, 0, 0, 2, '', '', '', '', DHYEY, 'local', null, null, []],
  [29, 'passed', 8602.868, '2026-08-27T12:41:59.377Z', 1, 1, 0, 0, 0, 0, 2, '', '', '', '', DHYEY, 'local', null, null, []],
  [28, 'incomplete', 65.664, '2026-08-24T05:56:33.856Z', 0, 0, 0, 0, 0, 33, 33, 'main', 'production', M_INIT, H_4D, DHYEY, 'local', null, null, ['dhyey/testing-PR']],
  [27, 'failed', 868822, '2026-08-07T03:30:43.61Z', 16, 19, 4, 6, 0, 0, 45, 'main', 'production', M_ROLES, H_F1, DHYEY, 'github-actions', null, null, []],
  [26, 'passed', 8217.069, '2026-08-06T10:13:25.374Z', 4, 0, 0, 0, 0, 0, 4, 'main', 'production', M_INIT, H_4D, DHYEY, 'local', null, null, []],
  [25, 'passed', 70.427, '2026-08-06T09:59:31.178Z', 0, 0, 0, 0, 0, 37, 37, 'main', 'production', M_INIT, H_4D, DHYEY, 'local', null, null, ['dhyey/testing-PR']],
  [24, 'failed', 14297.33, '2026-08-06T07:11:34.047Z', 1, 32, 0, 0, 0, 0, 33, 'main', 'production', M_INIT, H_4D, DHYEY, 'local', null, null, ['dhyey/testing-PR']],
  [23, 'failed', 1586.214, '2026-08-06T07:08:32.808Z', 0, 6, 0, 0, 0, 0, 6, 'main', 'production', M_INIT, H_4D, DHYEY, 'local', null, null, ['dhyey/testing-PR']],
  [22, 'passed', 1890.893, '2026-08-06T06:40:49.581Z', 9, 0, 0, 0, 0, 0, 9, 'bhavy/tests', 'testing', M_TAGS, H_B8, BHAVY, 'local', null, null, []],
  [21, 'failed', 156281.798, '2026-08-06T06:11:46.622Z', 12, 21, 0, 0, 0, 0, 33, 'main', 'production', M_INIT, H_4D, DHYEY, 'github-actions', null, null, ['main']],
  [20, 'failed', 144231.309, '2026-08-06T06:01:37.411Z', 12, 21, 0, 0, 0, 0, 33, 'main', 'production', M_MERGE1, 'a3685a4bc25e3524d830f07d11e41e5228267d33', DHYEY, 'github-actions', null, null, ['main']],
  [19, 'failed', 751605, '2026-08-06T05:52:46.466Z', 37, 13, 0, 5, 0, 0, 55, 'bhavy/tests', 'testing', M_TAGS, H_B8, BHAVY, 'github-actions', 22, null, []],
  [18, 'failed', 151283.914, '2026-08-06T05:49:08.517Z', 12, 21, 0, 0, 0, 0, 33, 'dhyey/testing-PR', 'staging', M_VISUAL, H_68, DHYEY, 'local', null, null, ['dhyey/testing-PR']],
  [17, 'passed', 22.69, '2026-08-06T05:46:47.364Z', 0, 0, 0, 0, 0, 33, 33, 'dhyey/testing-PR', 'staging', M_VISUAL, H_68, DHYEY, 'local', null, null, ['dhyey/testing-PR']],
  [16, 'passed', 22.276, '2026-08-06T05:46:43.287Z', 0, 0, 0, 0, 0, 33, 33, 'dhyey/testing-PR', 'staging', M_VISUAL, H_68, DHYEY, 'local', null, null, ['dhyey/testing-PR']],
  [15, 'passed', 22.227, '2026-08-06T05:46:37.601Z', 0, 0, 0, 0, 0, 23, 23, 'dhyey/testing-PR', 'staging', M_VISUAL, H_68, DHYEY, 'local', null, null, ['dhyey/testing-PR']],
  [14, 'passed', 29.25, '2026-08-06T05:46:35.389Z', 0, 0, 0, 0, 0, 33, 33, 'dhyey/testing-PR', 'staging', M_VISUAL, H_68, DHYEY, 'local', null, null, ['dhyey/testing-PR']],
  [13, 'failed', 175375.368, '2026-08-06T05:25:48.93Z', 11, 22, 0, 0, 0, 0, 33, 'dhyey/testing-PR', 'staging', M_VISUAL, H_68, DHYEY, 'local', null, null, ['dhyey/testing-PR']],
  [12, 'passed', 22.046, '2026-08-06T05:25:15.105Z', 0, 0, 0, 0, 0, 33, 33, 'dhyey/testing-PR', 'staging', M_VISUAL, H_68, DHYEY, 'local', null, null, ['dhyey/testing-PR']],
  [11, 'passed', 95.196, '2026-08-06T05:25:06.467Z', 0, 0, 0, 0, 0, 33, 33, 'dhyey/testing-PR', 'staging', M_VISUAL, H_68, DHYEY, 'local', null, null, ['dhyey/testing-PR']],
  [10, 'failed', 749034, '2026-08-06T04:27:41.554Z', 35, 13, 1, 6, 0, 0, 55, 'bhavy/tests', 'testing', M_TAGS, H_B8, BHAVY, 'github-actions', 22, null, []],
  [9, 'failed', 858316, '2026-08-06T03:38:20.827Z', 22, 14, 3, 6, 0, 0, 45, 'main', 'production', M_ROLES, H_F1, DHYEY, 'github-actions', null, null, []],
  [8, 'failed', 747476, '2026-08-05T11:21:24.269Z', 37, 14, 0, 4, 0, 0, 55, 'bhavy/tests', 'testing', M_ONLY, '558c5ec926159afe4095ef8b14beb4c1e130acb4', BHAVY, 'github-actions', 22, null, []],
  [7, 'failed', 2592, '2026-08-05T11:12:55.4Z', 0, 0, 0, 0, 0, 0, 0, 'bhavy/tests', 'testing', M_TAGSPEC, 'deac856ed13a1ccb954ff27aedb9b4dea02f37cd', BHAVY, 'github-actions', 22, null, []],
  [6, 'failed', 777072, '2026-08-05T08:49:35.214Z', 23, 15, 1, 6, 0, 0, 45, 'main', 'production', M_ROLES, H_F1, DHYEY, 'github-actions', null, null, []],
  [5, 'failed', 137938.949, '2026-08-05T08:46:01.444Z', 11, 22, 0, 0, 0, 0, 33, 'dhyey/testing-PR', 'staging', M_VISUAL, H_68, DHYEY, 'local', null, null, []],
  [4, 'interrupted', 2892, '2026-08-05T07:19:28.68Z', 0, 0, 0, 0, 0, 0, 0, 'dhyey/user-roles', 'unmapped', M_MANUAL, H_69, DHYEY, 'local', null, null, []],
  [3, 'failed', 132804.619, '2026-08-05T05:40:54.327Z', 22, 11, 0, 0, 0, 0, 33, 'dhyey/testing-PR', 'staging', M_VISUAL, H_68, DHYEY, 'local', null, null, []],
  [2, 'failed', 957932, '2026-08-05T05:19:39.879Z', 20, 16, 3, 6, 0, 0, 45, 'main', 'production', M_ROLES, H_F1, DHYEY, 'github-actions', null, null, []],
  [1, 'failed', 273.899, '2026-08-05T05:17:54.046Z', 0, 0, 0, 0, 0, 0, 0, 'dhyey/user-roles', 'unmapped', M_MANUAL, H_69, DHYEY, 'local', null, null, []],
]

export const runs = RAW.map((row) => {
  const o = {}
  COLUMNS.forEach((c, i) => {
    o[c] = row[i]
  })
  o.id = 'test_run_' + String(o.counter).padStart(4, '0')
  // Exécutions : seulement deux statuts, « Réussi » et « Échoué ».
  // Les statuts intermédiaires de l'API (flaky, interrupted, unknown, incomplet)
  // sont repliés sur `failed`, et les résultats bloqués/ignorés sont comptés
  // comme des échecs pour conserver le total du run.
  o.status = o.status === 'passed' ? 'passed' : 'failed'
  o.results = {
    passed: o.passed,
    failed: o.failed + o.flaky + o.interrupted + o.unknown + o.skipped,
  }
  return o
})

// Les dates de l'API sont figées (24 sept. 2026). On les recale sur l'instant de
// chargement de la démo en conservant les écarts relatifs : les filtres
// « 24 heures », « 7 jours » et « 30 jours » restent ainsi tous parlants au fil
// du temps. À retirer lors du branchement Supabase (dates réelles).
const latestStart = Math.max(...runs.map((r) => new Date(r.startTime).getTime()))
const clockShift = Date.now() - latestStart
runs.forEach((r) => {
  r.startTime = new Date(new Date(r.startTime).getTime() + clockShift).toISOString()
})

export const environments = [
  { name: 'production', label: 'PROD', color: '#f42222', branches: ['main'] },
  { name: 'staging', label: 'STAGE', color: '#f2994a', branches: ['dhyey/testing-PR'] },
  { name: 'development', label: 'DEV', color: '#a855f7', branches: ['dev'] },
  { name: 'testing', label: 'QA', color: '#64748b', branches: ['bhavy/tests'] },
]

export const filters = {
  statuses: ['passed', 'failed'],
  environments: ['production', 'staging', 'development', 'testing'],
  branches: [
    'bhavy/organization',
    'bhavy/tests',
    'dhyey/testing',
    'dhyey/testing-PR',
    'dhyey/user-roles',
    'main',
  ],
  ci: ['github-actions', 'local'],
  tags: ['@api', '@auth', '@e2e', '@nightly', '@regression', '@smoke', '@ui', '@validation'],
}

// Suite exécutée par le run — issue de l'arbre de suites réel (data/suites.js).
// L'API runs ne remonte pas ce champ : on le dérive ici de façon déterministe.
const RUN_SUITES = [
  'ShopSphere Web App',
  'Product Catalog & Search',
  'Authentication',
  'Organization Management',
  'Settings',
  'Test Runs',
]
runs.forEach((r) => {
  r.suite = RUN_SUITES[r.counter % RUN_SUITES.length]
})

export const project = { name: 'Demo Project' }
export const org = { name: 'Demo Organization' }
