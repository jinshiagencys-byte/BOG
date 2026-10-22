// Cloche des nouveautés du header et son dialogue de changelog.
// Extraite pour être partagée par le header d'un projet (`Header.jsx`) et celui
// de l'espace organisation (`OrgHeader.jsx`).
import { useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import ChangelogDialog from './ChangelogDialog.jsx'
import { CHANGELOG_LATEST } from '../data/changelog.js'

// Clé localStorage du vrai site : mémorise la dernière version de changelog vue.
// Tant qu'elle diffère de la dernière version publiée, la cloche affiche une pastille.
const SEEN_KEY = 'td_changelog'

function readSeenVersion() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null')
    return raw && raw.v ? raw.v : null
  } catch {
    return null
  }
}

export default function ChangelogBell() {
  const [open, setOpen] = useState(false)
  const [unseen, setUnseen] = useState(() => readSeenVersion() !== CHANGELOG_LATEST)

  // Comme sur le site : ouvrir le changelog le marque immédiatement comme vu.
  const openChangelog = () => {
    setOpen(true)
    setUnseen(false)
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify({ v: CHANGELOG_LATEST }))
    } catch {
      /* localStorage indisponible : on ignore */
    }
  }

  return (
    <>
      <button
        className="td-iconbtn"
        type="button"
        data-testid="changelog-bell-btn"
        aria-label={unseen ? 'Nouveautés — mises à jour non consultées' : 'Nouveautés'}
        onClick={openChangelog}
      >
        <Icon name="bell" className="td-ic-16" />
        {unseen ? (
          <span aria-hidden="true" className="td-dot-red" data-testid="changelog-bell-indicator" />
        ) : null}
      </button>

      {/* Le dialogue est monté dans `document.body` (comme le portail Radix du
          site réel) pour ne pas hériter du contexte d'empilement du header. */}
      {open ? createPortal(<ChangelogDialog onClose={() => setOpen(false)} />, document.body) : null}
    </>
  )
}
