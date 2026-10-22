import { useEffect } from 'react'
import Icon from '../Icon.jsx'

// Notification furtive en bas à droite (feedback du drag & drop / création).
// `tone="error"` affiche une croix rouge (action impossible / déjà en cours).
export default function Toast({ message, onDone, tone = 'success' }) {
  const isError = tone === 'error'

  useEffect(() => {
    if (!message) return undefined
    const timer = setTimeout(onDone, 3000)
    return () => clearTimeout(timer)
  }, [message, onDone])

  return (
    <div
      className={`td-toast${message ? ' is-open' : ''}${isError ? ' is-error' : ''}`}
      role="status"
      aria-live="polite"
    >
      <Icon name={isError ? 'x' : 'check'} className="td-ic-16" />
      <span>{message}</span>
    </div>
  )
}
