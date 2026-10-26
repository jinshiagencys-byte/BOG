import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo.jsx'
import { useAuth } from '../app/auth-context.js'
import { supabase } from '../lib/supabase.js'

export default function ResetPasswordView() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setNotice('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setSaving(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setNotice('Password updated. Redirecting…')
    setTimeout(() => navigate('/projects', { replace: true }), 900)
  }

  return (
    <main className="td-auth">
      <Link to="/auth" className="td-auth-brand">
        <BrandLogo className="td-auth-logo" />
        <span>BOG</span>
      </Link>

      <section className="td-auth-panel">
        <h1 className="td-auth-title">Choose a new password</h1>

        {!session ? (
          <>
            <p className="td-auth-notice is-error" role="alert">
              This reset link is invalid or has expired.
            </p>
            <p className="td-auth-foot">
              <Link to="/auth">Back to sign in</Link>
            </p>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
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

            <div className="td-auth-field">
              <input
                className="td-auth-input"
                type="password"
                autoComplete="new-password"
                placeholder="New password"
                aria-label="New password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="td-auth-field">
              <input
                className="td-auth-input"
                type="password"
                autoComplete="new-password"
                placeholder="Confirm new password"
                aria-label="Confirm new password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
            <button type="submit" className="td-auth-submit" disabled={saving}>
              {saving ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
