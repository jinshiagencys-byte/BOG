import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import DashboardView from './views/DashboardView.jsx'
import TestRunsView from './views/TestRunsView.jsx'
import TestCasesView from './views/TestCasesView.jsx'
import OnboardingView from './views/OnboardingView.jsx'
import AuthView from './views/AuthView.jsx'
import PlaceholderView from './views/PlaceholderView.jsx'
import ProjectsView from './views/ProjectsView.jsx'
import { NAV_FLAT, ORG_NAV_FLAT } from './app/nav.js'
import { DEMO_PROJECT_SLUG } from './app/projects.js'

const BUILT = ['/dashboard', '/test-runs', '/test-cases']
const HOME = `/${DEMO_PROJECT_SLUG}/dashboard`

export default function App() {
  return (
    <Routes>
      {/* Écran d'onboarding : plein page, hors du shell (pas de sidebar ni header). */}
      <Route path="/onboarding" element={<OnboardingView />} />

      {/* Authentification : plein page, hors du shell. */}
      <Route path="/auth" element={<AuthView mode="signin" />} />
      <Route path="/auth/signup" element={<AuthView mode="signup" />} />

      {/* Espace organisation : sidebar « Workspace / General » + page Projects. */}
      <Route element={<AppShell variant="org" />}>
        <Route path="/projects" element={<ProjectsView />} />
        {ORG_NAV_FLAT.filter((i) => i.to !== '/projects').map((i) => (
          <Route key={i.to} path={i.to} element={<PlaceholderView title={i.name} />} />
        ))}
      </Route>

      {/* Espace projet : le slug du projet préfixe toutes les URLs (/DemoProject/dashboard). */}
      <Route path="/:project" element={<AppShell />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardView />} />
        <Route path="test-runs" element={<TestRunsView />} />
        <Route path="test-cases" element={<TestCasesView />} />
        {NAV_FLAT.filter((i) => !BUILT.includes(i.to)).map((i) => (
          <Route key={i.to} path={i.to.slice(1)} element={<PlaceholderView title={i.name} />} />
        ))}
      </Route>

      {/* Anciennes URLs à plat : /dashboard → /DemoProject/dashboard. */}
      {NAV_FLAT.map((i) => (
        <Route
          key={i.to}
          path={i.to}
          element={<Navigate to={`/${DEMO_PROJECT_SLUG}${i.to}`} replace />}
        />
      ))}

      <Route path="*" element={<Navigate to={HOME} replace />} />
    </Routes>
  )
}
