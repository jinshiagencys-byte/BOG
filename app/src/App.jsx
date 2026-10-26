import { Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell.jsx'
import DashboardView from './views/DashboardView.jsx'
import TestRunsView from './views/TestRunsView.jsx'
import TestCasesView from './views/TestCasesView.jsx'
import OnboardingView from './views/OnboardingView.jsx'
import OnboardingMembersView from './views/OnboardingMembersView.jsx'
import AuthView from './views/AuthView.jsx'
import ResetPasswordView from './views/ResetPasswordView.jsx'
import PlaceholderView from './views/PlaceholderView.jsx'
import ProjectsView from './views/ProjectsView.jsx'
import GithubSettingsView from './views/GithubSettingsView.jsx'
import ProjectSettingsView from './views/ProjectSettingsView.jsx'
import { NAV_FLAT, ORG_NAV_FLAT } from './app/nav.js'
import {
  AuthCallback,
  ProjectGate,
  RedirectIfAuthed,
  RequireAuth,
  RequireOrg,
} from './app/guards.jsx'

const BUILT = ['/dashboard', '/test-runs', '/test-cases', '/settings']
const HOME = '/projects'

export default function App() {
  return (
    <Routes>
      {/* Authentification : plein page, hors du shell. */}
      <Route
        path="/auth"
        element={
          <RedirectIfAuthed>
            <AuthView mode="signin" />
          </RedirectIfAuthed>
        }
      />
      <Route
        path="/auth/signup"
        element={
          <RedirectIfAuthed>
            <AuthView mode="signup" />
          </RedirectIfAuthed>
        }
      />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/auth/reset" element={<ResetPasswordView />} />

      <Route element={<RequireAuth />}>
        {/* Onboarding : plein page, hors du shell, tant qu'aucune organisation n'existe. */}
        <Route path="/onboarding" element={<OnboardingView />} />
        <Route path="/onboarding/members" element={<OnboardingMembersView />} />

        {/* Espace organisation : sidebar « Workspace / General » + page Projects. */}
        <Route element={<RequireOrg />}>
          <Route element={<AppShell variant="org" />}>
            <Route path="/projects" element={<ProjectsView />} />
            <Route path="/org-settings" element={<GithubSettingsView />} />
            <Route path="/billing" element={<PlaceholderView title="Facturation" />} />
            {ORG_NAV_FLAT.filter(
              (item) => !['/projects', '/org-settings'].includes(item.to),
            ).map((item) => (
              <Route
                key={item.to}
                path={item.to}
                element={<PlaceholderView title={item.name} />}
              />
            ))}
          </Route>
        </Route>
      </Route>

      {/* Espace projet : le slug du projet préfixe toutes les URLs (/DemoProject/dashboard). */}
      <Route
        path="/:project"
        element={
          <ProjectGate>
            <AppShell />
          </ProjectGate>
        }
      >
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardView />} />
        <Route path="test-runs" element={<TestRunsView />} />
        <Route path="test-cases" element={<TestCasesView />} />
        <Route path="settings" element={<ProjectSettingsView />} />
        {NAV_FLAT.filter((item) => !BUILT.includes(item.to)).map((item) => (
          <Route
            key={item.to}
            path={item.to.slice(1)}
            element={<PlaceholderView title={item.name} />}
          />
        ))}
      </Route>

      {/* Anciennes URLs à plat : on revient à l'espace organisation. */}
      {NAV_FLAT.map((item) => (
        <Route key={item.to} path={item.to} element={<Navigate to={HOME} replace />} />
      ))}

      <Route path="*" element={<Navigate to={HOME} replace />} />
    </Routes>
  )
}
