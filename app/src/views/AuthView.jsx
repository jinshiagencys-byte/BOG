import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { useAuth } from '../app/auth-context.js'
import { DEMO_PROJECT_SLUG } from '../app/projects.js'

function authMessage(error) {
  const raw = String(error?.message || '').toLowerCase()
  if (raw.includes('invalid login credentials')) {
    return 'Incorrect email or password.'
  }
  if (raw.includes('email not confirmed')) {
    return 'Please confirm your email address before signing in.'
  }
  if (raw.includes('user already registered')) {
    return 'An account already exists with this email address.'
  }
  if (raw.includes('password')) {
    return 'Password must be at least 8 characters long.'
  }
  return error?.message || 'Authentication failed.'
}

// Logo Google multicolore (les icônes Lucide n'embarquent pas les marques).
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="td-auth-google">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.88-3c-1.08.72-2.46 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.28a12 12 0 0 0 0 10.76l4.01-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.6 4.58 1.79l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.28 6.62l4.01 3.1C6.23 6.88 8.88 4.77 12 4.77Z"
      />
    </svg>
  )
}

export default function AuthView({ mode = 'signin' }) {
  const isSignup = mode === 'signup'
  const navigate = useNavigate()
  const { signIn, signUp, resetPassword } = useAuth()

  // Adresse mémorisée depuis une connexion précédente (état initial, sans effet).
  const [form, setForm] = useState(() => {
    let email = ''
    if (!isSignup) {
      try {
        email = localStorage.getItem('td-remember-email') || ''
      } catch {
        /* localStorage indisponible */
      }
    }
    return { name: '', email, password: '' }
  })
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(() => Boolean(form.email))
  const [terms, setTerms] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }))
    setError('')
    setNotice('')
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')

    if (!form.email.trim() || !form.password) {
      setError('Enter your email address and password.')
      return
    }
    if (isSignup && !form.name.trim()) {
      setError('Enter your full name.')
      return
    }
    if (isSignup && form.password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (isSignup && !terms) {
      setError('Please accept the Terms of Service and Privacy Policy.')
      return
    }

    try {
      if (!isSignup && remember) localStorage.setItem('td-remember-email', form.email.trim())
      if (!isSignup && !remember) localStorage.removeItem('td-remember-email')
    } catch {
      /* ignore */
    }

    setSubmitting(true)
    try {
      if (isSignup) {
        const data = await signUp({
          email: form.email,
          password: form.password,
          fullName: form.name,
        })
        if (data.session) {
          navigate('/onboarding', { replace: true })
        } else {
          setNotice(
            'Compte créé. Vérifiez votre boîte e-mail pour confirmer votre adresse avant de vous connecter.',
          )
        }
      } else {
        await signIn(form.email, form.password)
        navigate('/projects', { replace: true })
      }
    } catch (submitError) {
      setError(authMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  const oauth = (provider) =>
    setNotice(`${provider} sign-in is not configured on this deployment.`)

  const forgot = async () => {
    setError('')
    setNotice('')
    if (!form.email.trim()) {
      setError('Enter your email address first.')
      return
    }
    setSubmitting(true)
    try {
      await resetPassword(form.email)
      setNotice(`Password reset link sent to ${form.email.trim()}.`)
    } catch (resetError) {
      setError(authMessage(resetError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="td-auth">
      <Link to="/auth" className="td-auth-brand">
        <Icon name="bird" className="td-auth-logo" />
        <span>TestDino</span>
      </Link>

      <section className="td-auth-panel">
        <h1 className="td-auth-title">
          {isSignup ? 'Create your account' : 'Sign in to TestDino'}
        </h1>

        <button type="button" className="td-auth-oauth" onClick={() => oauth('Google')}>
          <GoogleMark />
          <span>Continue with Google</span>
        </button>

        {!isSignup ? (
          <button type="button" className="td-auth-oauth" onClick={() => oauth('SSO')}>
            <Icon name="building-2" className="td-auth-sso" />
            <span>Continue with SSO</span>
          </button>
        ) : null}

        <div className="td-auth-or" role="separator">
          <span>OR</span>
        </div>

        {error ? (
          <p className="td-auth-notice is-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="td-auth-notice" role="status">
            {notice}
          </p>
        ) : null}

        <form onSubmit={submit} noValidate>
          {isSignup ? (
            <div className="td-auth-field">
              <input
                className="td-auth-input"
                type="text"
                autoComplete="name"
                placeholder="Full name"
                aria-label="Full name"
                value={form.name}
                onChange={set('name')}
              />
            </div>
          ) : null}

          <div className="td-auth-field">
            <input
              className="td-auth-input"
              type="email"
              autoComplete="email"
              placeholder="name@work-email.com"
              aria-label="Email"
              value={form.email}
              onChange={set('email')}
            />
          </div>

          <div className="td-auth-field">
            <input
              className="td-auth-input"
              type={showPassword ? 'text' : 'password'}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              placeholder="Password"
              aria-label="Password"
              value={form.password}
              onChange={set('password')}
            />
            <button
              type="button"
              className="td-auth-eye"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((s) => !s)}
            >
              <Icon name={showPassword ? 'eye-off' : 'eye'} className="td-ic-16" />
            </button>
          </div>

          {isSignup ? (
            <label className="td-auth-check td-auth-terms">
              <input
                type="checkbox"
                checked={terms}
                onChange={(e) => setTerms(e.target.checked)}
              />
              <span>
                I agree to the{' '}
                <a href="#terms" onClick={(e) => e.preventDefault()}>
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="#privacy" onClick={(e) => e.preventDefault()}>
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          ) : (
            <div className="td-auth-row">
              <label className="td-auth-check">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                <span>Remember me</span>
              </label>
              <button type="button" className="td-auth-textbtn" onClick={forgot}>
                Forgot password?
              </button>
            </div>
          )}

          <button
            type="submit"
            className="td-auth-submit"
            disabled={submitting || (isSignup && !terms)}
          >
            {submitting
              ? isSignup
                ? 'Creating account…'
                : 'Signing in…'
              : isSignup
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        <p className="td-auth-foot">
          {isSignup ? 'Already have an account? ' : 'Don’t have an account? '}
          <Link to={isSignup ? '/auth' : '/auth/signup'}>
            {isSignup ? 'Sign in' : 'Create an account'}
          </Link>
        </p>

        <p className="td-auth-foot">
          <Link to={`/${DEMO_PROJECT_SLUG}/dashboard`}>Explore the demo project</Link>
        </p>
      </section>
    </main>
  )
}
