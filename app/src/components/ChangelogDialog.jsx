// Dialogue « BOG Changelog » : ce qu'ouvre la cloche du header.
//
// Réplique du dialogue du vrai site (Radix Dialog + Accordion) :
// en-tête « Nouveautés BOG » + filtres produit,
// liste dépliable des entrées (la plus récente est ouverte par défaut) et pied
// avec le lien vers le changelog complet.
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import Markdown from './Markdown.jsx'
import { CHANGELOG, CHANGELOG_FILTERS, CHANGELOG_FULL_URL } from '../data/changelog.js'

// Couleurs du badge produit, identiques au site (bg-passed / skipped / flaky).
const BADGE_CLASS = {
  mcp: 'bg-passed-background text-passed',
  'web-app': 'bg-skipped-background text-skipped',
  cli: 'bg-flaky-background text-flaky',
}
const BADGE_LABEL = { mcp: 'MCP', 'web-app': 'Application web', cli: 'CLI' }

export default function ChangelogDialog({ onClose }) {
  // La 1re entrée (la plus récente) est dépliée par défaut, comme sur le site.
  const [filter, setFilter] = useState('all')
  const [openSlug, setOpenSlug] = useState(() => CHANGELOG[0]?.slug ?? null)
  const boxRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    boxRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const entries = filter === 'all' ? CHANGELOG : CHANGELOG.filter((e) => e.type === filter)

  return (
    <div className="td-changelog" role="dialog" aria-modal="true" aria-labelledby="td-changelog-title">
      <div className="td-changelog-backdrop" onClick={onClose} />

      <div className="td-changelog-box" tabIndex={-1} ref={boxRef}>
        <div className="td-changelog-head">
          <h2 id="td-changelog-title">Nouveautés BOG</h2>
          <div className="td-changelog-filters" data-testid="changelog-product-filter">
            {CHANGELOG_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                className={filter === f.id ? 'is-active' : ''}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="td-changelog-body">
          {entries.map((entry) => {
            const open = openSlug === entry.slug
            return (
              <div className="td-changelog-row" key={entry.id}>
                <button
                  type="button"
                  className="td-changelog-trigger"
                  data-testid={`changelog-row-${entry.slug}`}
                  aria-expanded={open}
                  onClick={() => setOpenSlug(open ? null : entry.slug)}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <h3 className="truncate text-sm font-semibold text-foreground">{entry.title}</h3>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className={
                          'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ' +
                          BADGE_CLASS[entry.type]
                        }
                      >
                        {BADGE_LABEL[entry.type]}
                      </span>
                      <span>v{entry.version}</span>
                      <span aria-hidden="true">·</span>
                      <span>{entry.date}</span>
                    </div>
                  </div>
                  <Icon
                    name="chevron-down"
                    className={
                      'h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform' +
                      (open ? ' rotate-180' : '')
                    }
                  />
                </button>

                {open ? (
                  <div className="td-changelog-panel" data-state="open">
                    <div className="space-y-3 px-3 pb-4">
                      <Markdown>{entry.body}</Markdown>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="td-changelog-foot">
          <a
            href={CHANGELOG_FULL_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="changelog-view-full-link"
          >
            Consulter toutes les nouveautés
            <Icon name="arrow-right" className="h-3.5 w-3.5" />
          </a>
        </div>

        <button type="button" className="td-changelog-close" aria-label="Fermer" onClick={onClose}>
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
