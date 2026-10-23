import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import Toast from '../components/testcases/Toast.jsx'
import { PageSkeleton } from '../components/Skeleton.jsx'
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
import { useProject } from '../app/project-context.js'
import { useAuth } from '../app/auth-context.js'
import { fmtDuration } from '../lib/format.js'
import {
  getSite,
  listPageChecks,
  listPages,
  listRuns,
  messageForError,
} from '../lib/api.js'

// Périodes proposées par le filtre du Dashboard.
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
          {subtitle ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
          ) : null}
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
  const passed = payload.find((item) => item.dataKey === 'passed')?.value ?? 0
  const failed = payload.find((item) => item.dataKey === 'failed')?.value ?? 0
  return (
    <div className="min-w-[140px] rounded-lg border border-border bg-card p-3 shadow-xl">
      <p className="mb-2 text-base font-bold text-primary">Exécution {label}</p>
      <div className="space-y-1.5">
        <TrendTooltipRow dot="bg-passed" name="Réussis" value={passed} />
        <TrendTooltipRow dot="bg-failed" name="Échoués" value={failed} />
        <div
          data-orientation="horizontal"
          role="none"
          className="h-[1px] w-full shrink-0 bg-border"
        />
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
            domain={[0, 'auto']}
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

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Bonjour'
  if (hour < 18) return 'Bon après-midi'
  return 'Bonsoir'
}

function isCheckUp(status) {
  const value = String(status || '').toLowerCase()
  return (
    ['up', 'ok', 'success', 'passed', 'healthy', '200'].includes(value) ||
    (!value.includes('down') && !value.includes('error') && !value.includes('fail'))
  )
}

function buildRealKpis(data) {
  if (!data) return []
  const pages = data.pages || []
  const checks = data.checks || []
  const runs = data.runs || []
  const activePages = pages.filter((page) => page.is_active !== false).length
  const up = checks.filter((check) => isCheckUp(check.status)).length
  const availability = checks.length
    ? Math.round((up / checks.length) * 1000) / 10
    : null
  const responseTimes = checks
    .map((check) => check.response_time_ms)
    .filter((value) => Number.isFinite(value) && value > 0)
  const averageLoad = responseTimes.length
    ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length
    : data.site?.load_time_ms ?? null
  const failedTests = runs.reduce((sum, run) => sum + run.results.failed, 0)

  return [
    {
      key: 'pages',
      label: 'Pages surveillées',
      icon: 'globe',
      value: pages.length,
      sub: `${activePages} active${activePages > 1 ? 's' : ''}`,
      subTone: 'none',
      tone: 'info',
    },
    {
      key: 'availability',
      label: 'Disponibilité',
      icon: 'activity',
      value: availability == null ? '—' : `${availability}%`,
      sub: `${checks.length} vérification${checks.length > 1 ? 's' : ''}`,
      subTone: availability != null && availability < 99 ? 'warn' : 'up',
      tone: availability != null && availability < 99 ? 'warn' : 'up',
    },
    {
      key: 'load',
      label: 'Temps de chargement',
      icon: 'gauge',
      value: averageLoad == null ? '—' : fmtDuration(averageLoad),
      sub: 'moyenne sur la période',
      subTone: 'none',
      tone: 'info',
    },
    {
      key: 'runs',
      label: 'Exécutions',
      icon: 'list-checks',
      value: runs.length,
      sub: failedTests
        ? `${failedTests} test${failedTests > 1 ? 's' : ''} échoué${failedTests > 1 ? 's' : ''}`
        : 'aucun échec',
      subTone: failedTests ? 'warn' : 'up',
      tone: failedTests ? 'down' : 'up',
    },
  ]
}

export default function DashboardView() {
  const { project, isDemo, loading, error } = useProject()

  if (loading) return <PageSkeleton rows={6} />
  if (error) {
    return (
      <>
        <div className="td-page-head">
          <h1>Tableau de bord</h1>
          <p>Impossible de charger ce projet.</p>
        </div>
        <div className="td-card-surface td-settings-note is-error">
          <Icon name="triangle-alert" className="td-ic-16" />
          <span>{error}</span>
        </div>
      </>
    )
  }
  if (!project) return null

  return <DashboardInner key={project.slug} project={project} isDemo={isDemo} />
}

function DashboardInner({ project, isDemo }) {
  const { user } = useAuth()
  const [period, setPeriod] = useState('30d')
  const [spinning, setSpinning] = useState(false)
  const [toast, setToast] = useState({ message: '', tone: 'success' })
  const [realData, setRealData] = useState(null)
  const [dataLoading, setDataLoading] = useState(!isDemo)
  const [dataError, setDataError] = useState('')
  const spinTimer = useRef(null)

  useEffect(
    () => () => {
      if (spinTimer.current) clearTimeout(spinTimer.current)
    },
    [],
  )

  const hideToast = useCallback(
    () => setToast((current) => ({ ...current, message: '' })),
    [],
  )

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (isDemo) {
        setDataLoading(false)
        setDataError('')
        return
      }
      if (!silent) setDataLoading(true)
      setDataError('')
      try {
        const days = PERIODS[period].days
        const cutoff = Date.now() - days * 86400000
        const [runs, pages, site] = await Promise.all([
          listRuns(project.id, { limit: 200 }),
          listPages(project.id),
          getSite(project.id),
        ])
        const checks = await listPageChecks(
          pages.map((page) => page.id),
          cutoff,
        )
        const recentRuns = runs.filter(
          (run) => new Date(run.startTime).getTime() >= cutoff,
        )
        setRealData({ runs: recentRuns, pages, site, checks })
      } catch (loadError) {
        setDataError(messageForError(loadError))
        if (!silent) setRealData(null)
      } finally {
        if (!silent) setDataLoading(false)
      }
    },
    [isDemo, period, project.id],
  )

  useEffect(() => {
    load()
  }, [load])

  const kpis = isDemo
    ? getSiteKpis(PERIODS[period].days)
    : buildRealKpis(realData)
  const trend = isDemo
    ? passFailTrend.slice(-PERIODS[period].days)
    : (realData?.runs || [])
        .slice()
        .reverse()
        .slice(-30)
        .map((run) => ({
          run: `#${run.counter}`,
          passed: run.results.passed,
          failed: run.results.failed,
        }))

  const refresh = async () => {
    setSpinning(true)
    if (spinTimer.current) clearTimeout(spinTimer.current)
    spinTimer.current = window.setTimeout(() => setSpinning(false), 700)
    if (!isDemo) await load({ silent: true })
    setToast({ message: 'Dashboard actualisé.', tone: 'success' })
  }

  const name =
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    null

  const hasRealData = Boolean(
    realData && (realData.runs.length || realData.pages.length),
  )

  return (
    <>
      <div className="td-page-head">
        <h1>
          {greeting()}
          {name ? `, ${name}` : ''}
        </h1>
        <p>Vue d’ensemble de la santé de vos tests et indicateurs clés</p>
      </div>

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

      {dataError ? (
        <div className="td-card-surface td-settings-note is-error">
          <Icon name="triangle-alert" className="td-ic-16" />
          <span>{dataError}</span>
          <button type="button" className="td-btn td-btn-ghost" onClick={() => load()}>
            Réessayer
          </button>
        </div>
      ) : null}

      {dataLoading ? (
        <PageSkeleton rows={4} />
      ) : !isDemo && !hasRealData ? (
        <div className="td-card-surface mt-4">
          <EmptyState
            icon="activity"
            title="Aucune donnée pour ce projet"
            description="Les KPI et l’évolution des tests apparaîtront ici dès la première exécution. En attendant, vous pouvez sélectionner des cas de test et lancer un run."
            action={
              <Link className="td-btn td-btn-primary" to={`/${project.slug}/test-cases`}>
                <Icon name="clipboard-list" className="td-ic-14" />
                Choisir des cas de test
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((kpi) => (
              <div key={kpi.key} className="td-card-surface p-4">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground"
                    title={kpi.label}
                  >
                    <Icon name={kpi.icon} className="td-ic-14" />
                    <span className="truncate">{kpi.label}</span>
                  </span>
                  {kpi.tone === 'up' ? (
                    <Icon name="trending-up" className="td-ic-14 text-passed" />
                  ) : kpi.tone === 'down' ? (
                    <Icon name="trending-down" className="td-ic-14 text-failed" />
                  ) : kpi.tone === 'warn' ? (
                    <Icon name="triangle-alert" className="td-ic-14 text-flaky" />
                  ) : (
                    <Icon name="activity" className="td-ic-14 text-muted-foreground" />
                  )}
                </div>
                <div className="mt-2 text-2xl font-semibold tracking-tight">{kpi.value}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span
                    className={
                      kpi.subTone === 'up'
                        ? 'text-passed'
                        : kpi.subTone === 'warn'
                          ? 'text-flaky'
                          : 'text-muted-foreground'
                    }
                  >
                    {kpi.sub}
                  </span>
                  {kpi.alert ? <span className="td-kpi-alert">{kpi.alert}</span> : null}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <Card
              title="Évolution des réussites et des échecs"
              subtitle="Nombre de tests réussis et échoués sur la période sélectionnée"
            >
              {trend.length ? (
                <TrendChart data={trend} />
              ) : (
                <div className="td-empty">
                  <Icon name="chart-no-axes-column" className="td-ic-20" />
                  <span>Aucune exécution sur cette période.</span>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <Toast message={toast.message} tone={toast.tone} onDone={hideToast} />
    </>
  )
}
