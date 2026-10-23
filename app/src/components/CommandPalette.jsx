import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { StatusDot } from './bits.jsx'
import { useApp } from '../app/app-context.js'
import { useProject } from '../app/project-context.js'
import { runs } from '../data/runs.js'
import { listRuns } from '../lib/api.js'

function PaletteInner({ onClose }) {
  const { openRun, runList } = useApp()
  const { project, isDemo } = useProject()
  const [q, setQ] = useState('')
  const [remote, setRemote] = useState([])

  useEffect(() => {
    if (isDemo || runList.length || !project?.id) return undefined
    let mounted = true
    listRuns(project.id, { limit: 50 })
      .then((rows) => {
        if (mounted) setRemote(rows)
      })
      .catch(() => {
        /* la palette reste vide si les exécutions sont inaccessibles */
      })
    return () => {
      mounted = false
    }
  }, [isDemo, project?.id, runList.length])

  // Démo : jeu statique. Projet réel : cache de la vue des exécutions, sinon
  // chargement direct depuis Supabase (jamais depuis l'API GitHub).
  const source = isDemo ? (runList.length ? runList : runs) : runList.length ? runList : remote
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
            <button key={r.id} className="td-pal-item" onClick={() => openRun(r, source)}>
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
