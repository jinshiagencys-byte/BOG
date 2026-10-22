/* ============================================================
   Ligne / carte d'un test run — markup partagé entre la vue Test Runs
   et la carte « Test Runs » du Dashboard (3 colonnes : Test Run · Suite ·
   Test Results ; les cartes remplacent le tableau sous 768 px).
   ============================================================ */
import Icon from './Icon.jsx'
import { ResultBadges, StatusDot } from './bits.jsx'
import { fmtDuration, timeAgo } from '../lib/format.js'

export function RunRow({ run, onOpen, needsAck, onAck }) {
  return (
    <tr
      className="td-row"
      tabIndex={0}
      onClick={() => onOpen(run)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(run)
        }
      }}
    >
      <td className="td-cell td-cell-run">
        <div className="td-run-head">
          <StatusDot status={run.status} />
          <a
            className="td-run-id"
            href={`#/run/${run.counter}`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onOpen(run)
            }}
          >
            #{run.counter}
          </a>
        </div>
        <div className="td-run-sub">
          <span className="td-meta">
            <Icon name="timer" className="td-ic-12" />
            {fmtDuration(run.durationMs)}
          </span>
          {needsAck ? (
            <button
              type="button"
              className="td-ack"
              title={`Marquer l’exécution #${run.counter} comme acquittée`}
              onClick={(e) => {
                e.stopPropagation()
                onAck(run)
              }}
            >
              à acquitter
            </button>
          ) : null}
        </div>
      </td>

      <td className="td-cell td-cell-suite">
        <div className="td-suite-name" title={run.suite}>
          <Icon name="folder" className="td-ic-12" />
          <span>{run.suite || '—'}</span>
        </div>
        <div className="td-cell-sub">
          <span className="td-meta">
            <Icon name="clock" className="td-ic-12" />
            {timeAgo(run.startTime)}
          </span>
        </div>
      </td>

      <td className="td-cell td-cell-results">
        <ResultBadges run={run} />
        <div className="td-total">
          Total : <strong>{run.total}</strong>
        </div>
      </td>
    </tr>
  )
}

export function RunCard({ run, onOpen, needsAck, onAck }) {
  return (
    <article className="td-card" tabIndex={0} onClick={() => onOpen(run)}>
      <div className="td-card-head">
        <StatusDot status={run.status} />
        <a
          className="td-run-id"
          href={`#/run/${run.counter}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onOpen(run)
          }}
        >
          #{run.counter}
        </a>
        <span className="td-meta td-card-right">
          <Icon name="timer" className="td-ic-12" />
          {fmtDuration(run.durationMs)}
        </span>
      </div>
      <div className="td-card-suite">
        <Icon name="folder" className="td-ic-12" />
        <span>{run.suite || '—'}</span>
      </div>
      <div className="td-card-meta">
        <span className="td-meta">
          <Icon name="clock" className="td-ic-12" />
          {timeAgo(run.startTime)}
        </span>
        {needsAck ? (
          <button
            type="button"
            className="td-ack"
            title={`Marquer l’exécution #${run.counter} comme acquittée`}
            onClick={(e) => {
              e.stopPropagation()
              onAck(run)
            }}
          >
            à acquitter
          </button>
        ) : null}
      </div>
      <div className="td-card-foot">
        <div className="td-badges">
          <ResultBadges run={run} />
          <span className="td-total">
            Total : <strong>{run.total}</strong>
          </span>
        </div>
      </div>
    </article>
  )
}
