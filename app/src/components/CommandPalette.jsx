import { useState } from 'react'
import { useParams } from 'react-router-dom'
import Icon from './Icon.jsx'
import { StatusDot } from './bits.jsx'
import { useApp } from '../app/app-context.js'
import { runs } from '../data/runs.js'
import { DEMO_PROJECT_SLUG } from '../app/projects.js'

function PaletteInner({ onClose }) {
  const { openRun } = useApp()
  const { project } = useParams()
  const [q, setQ] = useState('')

  // Pas d'exécution d'exemple hors du projet de démo.
  const source = project === DEMO_PROJECT_SLUG ? runs : []
  const query = q.trim().toLowerCase()
  const hay = (r) =>
    ('#' + r.counter + ' ' + r.branch + ' ' + r.commitMessage + ' ' + r.author).toLowerCase()
  const results = (query ? source.filter((r) => hay(r).includes(query)) : source).slice(0, 8)

  return (
    <>
      <div className="td-palette-inputwrap">
        <Icon name="search" className="td-ic-16" />
        <input
          autoFocus
          type="text"
          placeholder="Rechercher dans TestDino..."
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="td-iconbtn" type="button" aria-label="Fermer" onClick={onClose}>
          <Icon name="x" className="td-ic-14" />
        </button>
      </div>
      <div className="td-palette-results">
        {results.length ? (
          results.map((r) => (
            <button key={r.id} className="td-pal-item" onClick={() => openRun(r)}>
              <StatusDot status={r.status} />
              <span className="td-pal-main">
                <b>#{r.counter}</b>{' '}
                <span className="td-pal-msg">{r.commitMessage || '(aucune modification)'}</span>
              </span>
              <span className="td-pal-meta">{r.branch || ''}</span>
            </button>
          ))
        ) : (
          <div className="td-pal-empty">Aucun résultat</div>
        )}
      </div>
    </>
  )
}

export default function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useApp()

  if (!paletteOpen) return null

  return (
    <div className="td-palette is-open" onClick={() => setPaletteOpen(false)}>
      <div
        className="td-palette-box"
        role="dialog"
        aria-label="Recherche"
        onClick={(e) => e.stopPropagation()}
      >
        <PaletteInner onClose={() => setPaletteOpen(false)} />
      </div>
    </div>
  )
}
