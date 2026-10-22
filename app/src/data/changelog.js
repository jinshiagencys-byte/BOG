// Changelog TestDino — données réelles capturées depuis l'API publique du site :
// https://changelog-api.testdino.com/api/v1/changelog?sortBy=publishDate&limit=15
//
// Seules les entrées **web-app** sont conservées ici : les 9 entrées `cli` et `mcp`
// du flux réel ont été retirées (demande produit). Pour les récupérer, relancer la
// requête ci-dessus et garder `changelogType` ∈ « web-app » | « cli » | « mcp ».
// Le champ `body` est le Markdown brut renvoyé par l'API (rendu par `components/Markdown.jsx`).

export const CHANGELOG_FULL_URL = 'https://changelog.testdino.com/'

export const CHANGELOG_FILTERS = [
  { id: 'all', label: 'Tout' },
  { id: 'web-app', label: 'Application web' },
]

export const CHANGELOG = [
  {
    id: "6accbfea7a489150a9592415",
    slug: "introducing-swarm-run-playwright-tests-faster-across-multiple-ci-machines",
    title: "Introducing Swarm: run Playwright tests faster across multiple CI machines",
    version: "3.6.0",
    type: "web-app",
    date: "Oct 12, 2026",
    body: "Run your Playwright test suite faster by distributing tests across multiple CI machines, with all results combined into one TestDino run.\n\n![Swarm: Run Playwright tests across multiple CI machines](https://tdstorageus.blob.core.windows.net/public/changelog/swarm-changelog-cover.webp)\n\n*View results from all CI machines in one TestDino report.*\n\n- **Faster test runs:** Run tests across multiple machines to reduce execution time.\n- **Automatic workload distribution:** Available machines automatically pick up more work.\n- **Single report:** View all test results together in one run.\n- **Machine-level visibility:** See which tests ran on each machine and track their results.\n- **No manual sharding:** No need to calculate or maintain shard splits.\n\nAvailable on **Team and Enterprise** plans.\n\n[Read full documentation](https://docs.testdino.com/guides/playwright-swarm-mode)",
  },
  {
    id: "6ac8e571344524940ba40ba7",
    slug: "test-controls-quarantine-flaky-tests-without-changing-code",
    title: "Test Controls: quarantine flaky tests without changing code",
    version: "3.5.0",
    type: "web-app",
    date: "Oct 09, 2026",
    body: "Stop a flaky test from failing your builds in a few clicks, with no code change.\n\n- **Quarantine a test**. It keeps running and reporting, but its failures stop failing the CI build. Every quarantine has an end date and an assignee, and ends on its own after 10 passes in a row, on its end date, or when its linked ticket is closed.\n- **Cover only 1 error**. Forgive one known failure; any other failure of the test still fails the build.\n- **Mark a test critical**. It must pass on the first try. A pass that needed a retry fails the build and is called out in Slack and on the pull request.\n- **Watch or assign a test**. Get a Slack message or email when it starts failing, becomes flaky, or recovers.\n- **Quarantine many tests** at once from Test Explorer, for example during an outage.\n\nYour test runs always show the real result: a quarantined failure still counts as failed on the test run page. Only the build result changes.\n\nOpen Test Controls in the project sidebar, or click Test Controls on any test. Requires `@testdino/playwright 2.8.0` or above.\n\n[Read the guide](https://docs.testdino.com/guides/test-controls)",
  },
  {
    id: "6ac620b70775d7ae2ff84f8d",
    slug: "custom-defect-types",
    title: "Custom defect types",
    version: "3.4.0",
    type: "web-app",
    date: "Oct 07, 2026",
    body: "You can now label **failed and flaky tests** using defect types defined by your team, such as Product bug, Automation bug, or Environment issue.\n\nAvailable on the **Pro plan and above**.\n\n- Label individual failed or flaky tests from the Run Summary, Errors tab, or test case page.\n- Label an **entire error group at once** to apply the same defect type to related failures.\n- Add a **short reason** to explain why the test was labeled.\n- See how much of a run has already been **triaged** from the Run Summary.\n- **Filter runs by defect type** or find tests that have not been triaged yet.\n- Owners and admins can create, rename, archive, and manage defect types.\n- **Archived defect types** are removed from future selection while existing labels remain on past runs.\n\n#### Permissions\n\n**Owners and admins** can manage defect types, **Members** can label tests, and **Viewers and Billing Managers** can view labels but cannot change them.\n\n[Learn how to label failures with defect types](https://docs.testdino.com/guides/debug-playwright-failures/defect-types)",
  },
  {
    id: "6ac4b960114e4a54942ed7ee",
    slug: "re-run-failed-tests-inside-the-original-github-run",
    title: "Re-run failed tests inside the original GitHub run",
    version: "3.3.3",
    type: "web-app",
    date: "Oct 06, 2026",
    body: "[![Watch Video](https://img.youtube.com/vi/RSWKqo8GmWc/maxresdefault.jpg)](https://www.youtube.com/watch?v=RSWKqo8GmWc)\nWhen you re-run a failed Playwright run from TestDino, the failed jobs now retry inside the original GitHub Actions run instead of creating a new workflow run.\n\n- Only failed tests run again, so you do not need to wait for the full suite.\n- Each failed job re-runs only its own failed tests.\n- Your existing GitHub check stays on the same commit and can turn green after the retry.\n- No workflow file changes are required.\n- Before re-running, TestDino shows which tests will run.\n\n#### Also changed\n\nRe-runs no longer affect test run count, pass rate, or average duration. Individual re-run results are still available on each test.\n\n#### Requirements\n\nUse `@testdino/playwright` 2.7.8 or later and run your tests with:\n\n\n\n```bash\nnpx tdpw test\n```\n\nChoose **This commit** when re-running to retry inside the existing GitHub Actions run.\n\nChoosing **Latest** starts a new workflow run.\n\n[Learn how to re-run failed Playwright tests]( https://docs.testdino.com/guides/debug-playwright-failures/rerun-failed-tests)",
  },
  {
    id: "6abca9482d31d0cd302df227",
    slug: "ci-time-and-cost-suggestions-in-test-audit",
    title: "CI Time & Cost suggestions in Test Audit",
    version: "3.3.2",
    type: "web-app",
    date: "Sep 30, 2026",
    body: "Test Audit now tells you where your CI setup is costing you time and money, based on your own CI runs, with the exact line to fix it.\n\n- A new CI Time & Cost section gives setup suggestions based on your own CI runs, each with a line you can copy.\n- Your health score now counts tests that only pass on retry, and stops penalising setup choices you made on purpose.",
  },
  {
    id: "6ab3a34ad338a5e3b750b3f6",
    slug: "re-run-failed-tests-improved-ai-debugging-and-faster-test-management",
    title: "Re-run failed tests, improved AI debugging, and faster test management",
    version: "3.3.1",
    type: "web-app",
    date: "Sep 23, 2026",
    body: "## Dashboard 3.3.1\n\nRe-run failed or flaky tests directly from a completed test run, with the option to use the original commit or the latest code from the branch. You can also select individual tests, search within the selection, and group tests by spec file, failure reason, or browser.\n\n### Also new\n\n* **Debug with AI is easier to access.** Open it directly from the run actions to get a ready-to-use debugging prompt for your coding agent.\n* **Printable automated run reports.** Export a test run as a clean PDF and choose which test cases to include.\n* **Better report navigation.** Test cases in reports now open directly in the context of their test run.\n* **Linear support for manual runs.** Link Linear issues to manual test runs alongside Jira.\n* **Faster test management at scale.** Large projects with thousands of test cases now load, search, sort, and filter more efficiently.\n\n### Fixed\n\n* Improved GitHub installation linking.\n* Test audit scores now remain consistent for the same suite.\n* Live run feeds recover from temporary sync interruptions.\n* Automated results in manual runs now use the project browser when platform information is unavailable.",
  },
]

// Version de la dernière entrée : sert à savoir si le changelog a été vu
// (comparaison avec `localStorage.td_changelog`, comme sur le vrai site).
export const CHANGELOG_LATEST = CHANGELOG[0].version
