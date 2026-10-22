import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Toast from '../components/testcases/Toast.jsx'
import { Popover, RadioOption } from '../components/bits.jsx'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { passFailTrend } from '../data/dashboard.js'
import { getSiteKpis } from '../data/sites.js'
import { DEMO_PROJECT_SLUG } from '../app/projects.js'

// Périodes proposées par le filtre du Dashboard. Le jeu de démo contient 30
// exécutions : chaque période affiche les N dernières sur le graphique.
const PERIODS = {
  '7d': { label: '7 derniers jours', days: 7 },
  '14d': { label: '14 derniers jours', days: 14 },
  '30d': { label: '30 derniers jours', days: 30 },
}

function Card({ title, subtitle, right, children, className = '' }) {
  return (
    <section className={'td-card-surface flex flex-col ' + className}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p> : null}
        </div>
        {right ? <div className="ml-auto">{right}</div> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

function TrendTooltipRow({ dot, name, value }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {dot ? <div className={'h-2.5 w-2.5 rounded-full ' + dot} /> : null}
        <span className="text-sm text-primary">{name}</span>
      </div>
      <span className="ml-2 text-sm font-semibold text-primary">{value}</span>
    </div>
  )
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const passed = payload.find((p) => p.dataKey === 'passed')?.value ?? 0
  const failed = payload.find((p) => p.dataKey === 'failed')?.value ?? 0
  return (
    <div className="min-w-[140px] rounded-lg border border-border bg-card p-3 shadow-xl">
      <p className="mb-2 text-base font-bold text-primary">Exécution {label}</p>
      <div className="space-y-1.5">
        <TrendTooltipRow dot="bg-passed" name="Réussis" value={passed} />
        <TrendTooltipRow dot="bg-failed" name="Échoués" value={failed} />
        <div data-orientation="horizontal" role="none" className="h-[1px] w-full shrink-0 bg-border" />
        <TrendTooltipRow name="Total" value={passed + failed} />
      </div>
    </div>
  )
}

function TrendChart({ data }) {
  return (
    <div className="td-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 40, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="dashColorPassed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--passed))" stopOpacity={0.8} />
              <stop offset="95%" stopColor="hsl(var(--passed))" stopOpacity={0.1} />
            </linearGradient>
            <linearGradient id="dashColorFailed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--failed))" stopOpacity={0.8} />
              <stop offset="95%" stopColor="hsl(var(--failed))" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-line" />
          <XAxis
            dataKey="run"
            className="text-xs fill-muted-foreground"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis
            className="text-xs fill-muted-foreground"
            axisLine={false}
            allowDecimals={false}
            tickLine={false}
            tick={{ fontSize: 12 }}
            domain={[0, 40]}
            ticks={[0, 10, 20, 30, 40]}
          />
          <Tooltip content={<TrendTooltip />} />
          <Area
            type="monotone"
            dataKey="passed"
            stroke="hsl(var(--passed))"
            fill="url(#dashColorPassed)"
          />
          <Area
            type="monotone"
            dataKey="failed"
            stroke="hsl(var(--failed))"
            fill="url(#dashColorFailed)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// Salutation calculée au chargement de la page (hors rendu).
const GREETING = (() => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Bonjour'
  if (hour < 18) return 'Bon après-midi'
  return 'Bonsoir'
})()

export default function DashboardView() {
  const { project } = useParams()
  // Les jeux d'exemple (sites, checks, tendance) ne concernent que le projet de démo.
  const isDemo = project === DEMO_PROJECT_SLUG
  const [period, setPeriod] = useState('30d')
  const [spinning, setSpinning] = useState(false)
  const [toast, setToast] = useState({ message: '', tone: 'success' })
  const spinTimer = useRef(null)

  useEffect(
    () => () => {
      if (spinTimer.current) clearTimeout(spinTimer.current)
    },
    [],
  )

  const hideToast = useCallback(() => setToast((t) => ({ ...t, message: '' })), [])

  // « Actualiser » : animation courte + confirmation (données locales).
  const refresh = () => {
    setSpinning(true)
    if (spinTimer.current) clearTimeout(spinTimer.current)
    spinTimer.current = window.setTimeout(() => setSpinning(false), 700)
    setToast({ message: 'Dashboard actualisé.', tone: 'success' })
  }

  const kpis = useMemo(() => getSiteKpis(PERIODS[period].days), [period])
  const trend = passFailTrend.slice(-PERIODS[period].days)

  return (
    <>
      <div className="td-page-head">
        <h1>{GREETING}, Agency's</h1>
        <p>Vue d’ensemble de la santé de vos tests et indicateurs clés</p>
      </div>

      {isDemo ? (
        <>
          <div className="my-4 flex items-center gap-2">
            <Popover label={PERIODS[period].label} icon="calendar">
              <div className="td-pop-inner">
                {Object.entries(PERIODS).map(([value, meta]) => (
                  <RadioOption
                    key={value}
                    name="dash-period"
                    value={value}
                    label={meta.label}
                    checked={period === value}
                    onChange={setPeriod}
                  />
                ))}
              </div>
            </Popover>
            <button
              type="button"
              className={'td-refresh' + (spinning ? ' is-spinning' : '')}
              onClick={refresh}
            >
              <Icon name="refresh-cw" className="td-ic-14" />
              Actualiser
            </button>
          </div>

          {/* KPI de surveillance — calculés depuis les sites et les page_checks */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.key} className="td-card-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground"
                    title={k.label}
                  >
                    <Icon name={k.icon} className="td-ic-14" />
                    <span className="truncate">{k.label}</span>
                  </span>
                  {k.tone === 'up' ? (
                    <Icon name="trending-up" className="td-ic-14 text-passed" />
                  ) : k.tone === 'down' ? (
                    <Icon name="trending-down" className="td-ic-14 text-failed" />
                  ) : k.tone === 'warn' ? (
                    <Icon name="triangle-alert" className="td-ic-14 text-flaky" />
                  ) : (
                    <Icon name="activity" className="td-ic-14 text-muted-foreground" />
                  )}
                </div>
                <div className="mt-2 text-2xl font-semibold tracking-tight">{k.value}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span
                    className={
                      k.subTone === 'up'
                        ? 'text-passed'
                        : k.subTone === 'warn'
                          ? 'text-flaky'
                          : 'text-muted-foreground'
                    }
                  >
                    {k.sub}
                  </span>
                  {k.alert ? <span className="td-kpi-alert">{k.alert}</span> : null}
                </div>
              </div>
            ))}
          </div>

          {/* Évolution des réussites et des échecs */}
          <div className="mt-4">
            <Card title="Évolution des réussites et des échecs" subtitle="Nombre de tests réussis et échoués sur la période sélectionnée">
              <TrendChart data={trend} />
            </Card>
          </div>
        </>
      ) : (
        <div className="td-card-surface mt-4">
          <EmptyState
            icon="activity"
            title="Aucune donnée de surveillance pour ce projet"
            description="Les sites surveillés, les KPI et l’évolution des tests apparaîtront ici dès les premières exécutions. En attendant, le projet de démonstration conserve le jeu de données d’exemple."
            action={
              <Link className="td-btn" to={`/${DEMO_PROJECT_SLUG}/dashboard`}>
                <Icon name="activity" className="td-ic-14" />
                Voir le projet de démo
              </Link>
            }
          />
        </div>
      )}

      <Toast message={toast.message} tone={toast.tone} onDone={hideToast} />
    </>
  )
}
