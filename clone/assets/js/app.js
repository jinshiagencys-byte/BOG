/* ============================================================
   TestDino clone — logique d'application
   Rendu du tableau / cartes, filtres, recherche (Ctrl+K),
   thème clair/sombre, sidebar, pagination, tiroir de détail.
   ============================================================ */
(function () {
  'use strict';

  const DATA = window.TD_DATA;
  const RUNS = DATA.runs;
  const PERIOD_DAYS = { '24h': 1, '7days': 7, '30days': 30, '90days': 90, '6months': 182, '1year': 365, 'all': Infinity };
  const PERIOD_LABEL = { '24h': 'Last 24 hours', '7days': 'Last 7 days', '30days': 'Last 30 days', '90days': 'Last 90 days', '6months': 'Last 6 months', '1year': 'Last year', 'all': 'All time' };

  const state = {
    q: '',
    period: '6months',
    statuses: new Set(),
    branches: new Set(),
    envs: new Set(),
    cis: new Set(),
    tags: new Set(),
    page: 1,
    limit: 10
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDuration(ms) {
    if (ms == null) return '—';
    if (ms < 1000) return Math.round(ms) + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    const m = Math.floor(ms / 60000);
    const s = Math.round((ms % 60000) / 1000);
    return m + 'm ' + s + 's';
  }
  function timeAgo(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    const diff = Math.max(0, Date.now() - then);
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'Just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + (min === 1 ? ' minute ago' : ' minutes ago');
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + (hr === 1 ? ' hour ago' : ' hours ago');
    const d = Math.floor(hr / 24);
    if (d < 7) return d + (d === 1 ? ' day ago' : ' days ago');
    const w = Math.floor(d / 7);
    if (d < 30) { const rd = d % 7; return w + (w === 1 ? ' week' : ' weeks') + (rd ? ' ' + rd + (rd === 1 ? ' day' : ' days') : '') + ' ago'; }
    const mo = Math.floor(d / 30);
    return mo + (mo === 1 ? ' month ago' : ' months ago');
  }
  function shortHash(h) { return h ? h.slice(0, 7) : ''; }
  function initials(name) {
    if (!name) return '?';
    const parts = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  const AVATAR_PALETTE = ['blue', 'cyan', 'purple', 'rose', 'amber', 'olive', 'magenta'];
  function avatarColor(name) {
    let h = 0; for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
  }
  function statusMeta(s) {
    const M = {
      passed: { label: 'Passed', icon: 'check', cls: 'bg-passed', text: 'text-white' },
      failed: { label: 'Failed', icon: 'x', cls: 'bg-failed', text: 'text-white' },
      flaky: { label: 'Flaky', icon: 'triangle-alert', cls: 'bg-flaky', text: 'text-white' },
      skipped: { label: 'Skipped', icon: 'minus', cls: 'bg-skipped', text: 'text-white' },
      interrupted: { label: 'Interrupted', icon: 'ban', cls: 'bg-interrupted', text: 'text-white' },
      incomplete: { label: 'Incomplete', icon: 'circle-dashed', cls: 'bg-incomplete', text: 'text-white' },
      running: { label: 'Running', icon: 'loader', cls: 'bg-running', text: 'text-white' }
    };
    return M[s] || { label: s || 'Unknown', icon: 'circle', cls: 'bg-muted-foreground', text: 'text-white' };
  }
  function envMeta(name) {
    if (!name || name === 'unmapped') return { label: 'Unmapped', color: 'hsl(var(--env-unmapped))', muted: true };
    const found = DATA.environments.find(e => e.name === name);
    if (!found) return { label: name, color: 'hsl(var(--env-unmapped))', muted: true };
    const varmap = { production: '--env-production', staging: '--env-staging', development: '--env-development-text', testing: '--env-testing' };
    return { label: found.label, color: 'hsl(var(' + (varmap[name] || '--env-unmapped') + '))', muted: false };
  }
  function ciMeta(ci) {
    if (ci === 'github-actions') return { label: 'GitHub Actions', icon: 'workflow' };
    if (ci === 'local') return { label: 'Local', icon: 'terminal' };
    return { label: ci || '—', icon: 'terminal' };
  }

  /* ---------- filtering ---------- */
  function periodCutoff() {
    const days = PERIOD_DAYS[state.period];
    if (days === Infinity) return 0;
    return Date.now() - days * 86400000;
  }
  function visibleRuns() {
    const cutoff = periodCutoff();
    const q = state.q.trim().toLowerCase();
    return RUNS.filter(function (r) {
      if (new Date(r.startTime).getTime() < cutoff) return false;
      if (state.statuses.size && !state.statuses.has(r.status)) return false;
      if (state.branches.size && !state.branches.has(r.branch)) return false;
      if (state.envs.size && !state.envs.has(r.env || 'unmapped')) return false;
      if (state.cis.size && !state.cis.has(r.ci)) return false;
      if (state.tags.size && !r.tags.some(t => state.tags.has(t))) return false;
      if (q) {
        const hay = ('#' + r.counter + ' ' + r.branch + ' ' + r.commitMessage + ' ' + r.commitHash + ' ' + r.author + ' ' + (r.env || '') + ' ' + r.tags.join(' ')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /* ---------- icons ---------- */
  function icon(name, cls) {
    return '<i data-lucide="' + name + '" class="' + (cls || '') + '"></i>';
  }
  function refreshIcons() { if (window.lucide) window.lucide.createIcons(); }

  /* ---------- row rendering ---------- */
  function resultBadges(r) {
    const defs = [
      ['passed', r.passed], ['failed', r.failed], ['flaky', r.flaky], ['skipped', r.skipped]
    ];
    return defs.map(function (d) {
      return '<span class="td-badge bg-' + d[0] + '-background text-' + d[0] + ' border-' + d[0] + '-border" title="' + d[0] + '">' + d[1] + '</span>';
    }).join('');
  }
  function aiBadge(r) {
    if (!r.ai) return '<span class="text-muted-foreground">—</span>';
    return '<span class="td-badge border-ui-border bg-ui-background text-ui-text" title="AI insights">' +
      '<strong class="font-semibold">' + r.ai.count + '</strong><span class="ml-1">' + esc(r.ai.category) + '</span></span>';
  }
  function envBadge(name) {
    const e = envMeta(name);
    return '<span class="td-env" style="color:' + e.color + ';border-color:' + e.color + '33;background:' + e.color + '1a">' +
      '<span class="td-env-dot" style="background:' + e.color + '"></span>' + e.label + '</span>';
  }
  function authorAvatar(name) {
    const c = avatarColor(name);
    return '<span class="td-avatar bg-' + c + '-background text-' + c + '-foreground">' + esc(initials(name)) + '</span>';
  }

  function runRowHTML(r) {
    const s = statusMeta(r.status);
    const ci = ciMeta(r.ci);
    const rerun = r.rerunOf ? '<span class="td-rerun">' + icon('rotate-ccw', 'td-ic-12') + 'Re-run of #' + r.rerunOf + '</span>' : '';
    const pr = r.pr ? '<span class="td-pr" title="Pull request">' + icon('git-pull-request', 'td-ic-12') + 'PR #' + r.pr + '</span>' : '';
    const tags = (r.tags || []).map(t => '<span class="td-tag">' + esc(t) + '</span>').join('');
    return '' +
      '<tr class="td-row" data-id="' + r.id + '" data-href="#/run/' + r.counter + '" tabindex="0">' +
        '<td class="td-cell td-cell-run">' +
          '<div class="td-run-head">' +
            '<span class="td-status ' + s.cls + ' ' + s.text + '" title="' + s.label + '">' + icon(s.icon, 'td-ic-12') + '</span>' +
            '<a class="td-run-id" href="#/run/' + r.counter + '" onclick="event.stopPropagation()">#' + r.counter + '</a>' +
            rerun + pr +
          '</div>' +
          '<div class="td-run-sub">' +
            '<span class="td-meta">' + icon('timer', 'td-ic-12') + fmtDuration(r.durationMs) + '</span>' +
            '<a class="td-meta td-ci" href="#" onclick="event.preventDefault();event.stopPropagation()">' + icon(ci.icon, 'td-ic-12') + esc(ci.label) + '</a>' +
          '</div>' +
        '</td>' +
        '<td class="td-cell td-cell-commit">' +
          '<div class="td-commit-msg" title="' + esc(r.commitMessage) + '">' + esc(r.commitMessage || '—') + '</div>' +
          '<div class="td-commit-sub">' +
            (r.commitHash ? '<code class="td-hash">' + shortHash(r.commitHash) + '</code>' : '<span class="text-muted-foreground">no commit</span>') +
            (r.author ? '<span class="td-author">' + authorAvatar(r.author) + esc(r.author) + '</span>' : '') +
            '<span class="td-meta">' + icon('clock', 'td-ic-12') + timeAgo(r.startTime) + '</span>' +
          '</div>' +
        '</td>' +
        '<td class="td-cell">' +
          '<div class="td-branch-col">' +
            (r.branch ? '<div class="td-branch">' + icon('git-branch', 'td-ic-12') + '<span>' + esc(r.branch) + '</span></div>' : '<div class="td-branch td-empty-branch">' + icon('git-branch', 'td-ic-12') + '<span>—</span></div>') +
            '<div class="td-env-row">' + envBadge(r.env) + tags + '</div>' +
          '</div>' +
        '</td>' +
        '<td class="td-cell td-cell-results">' +
          '<div class="td-badges">' + resultBadges(r) + '</div>' +
          '<div class="td-total">Total: <strong>' + r.total + '</strong></div>' +
        '</td>' +
        '<td class="td-cell td-cell-ai">' + aiBadge(r) + '</td>' +
      '</tr>';
  }

  function runCardHTML(r) {
    const s = statusMeta(r.status);
    const ci = ciMeta(r.ci);
    return '' +
      '<article class="td-card" data-id="' + r.id + '" tabindex="0">' +
        '<div class="td-card-head">' +
          '<span class="td-status ' + s.cls + ' ' + s.text + '">' + icon(s.icon, 'td-ic-12') + '</span>' +
          '<a class="td-run-id" href="#/run/' + r.counter + '">#' + r.counter + '</a>' +
          (r.rerunOf ? '<span class="td-rerun">' + icon('rotate-ccw', 'td-ic-12') + 'Re-run of #' + r.rerunOf + '</span>' : '') +
          '<span class="td-meta td-card-right">' + icon('timer', 'td-ic-12') + fmtDuration(r.durationMs) + '</span>' +
        '</div>' +
        '<div class="td-card-commit">' + esc(r.commitMessage || '—') + '</div>' +
        '<div class="td-card-meta">' +
          (r.commitHash ? '<code class="td-hash">' + shortHash(r.commitHash) + '</code>' : '') +
          (r.author ? '<span class="td-author">' + authorAvatar(r.author) + esc(r.author) + '</span>' : '') +
          '<span class="td-meta">' + icon('clock', 'td-ic-12') + timeAgo(r.startTime) + '</span>' +
        '</div>' +
        '<div class="td-card-meta">' +
          (r.branch ? '<span class="td-branch">' + icon('git-branch', 'td-ic-12') + esc(r.branch) + '</span>' : '') +
          envBadge(r.env) +
          (r.pr ? '<span class="td-pr">' + icon('git-pull-request', 'td-ic-12') + 'PR #' + r.pr + '</span>' : '') +
        '</div>' +
        '<div class="td-card-foot">' +
          '<div class="td-badges">' + resultBadges(r) + '<span class="td-total">Total: <strong>' + r.total + '</strong></span></div>' +
          aiBadge(r) +
        '</div>' +
      '</article>';
  }

  /* ---------- main render ---------- */
  function render() {
    const filtered = visibleRuns();
    const pages = Math.max(1, Math.ceil(filtered.length / state.limit));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * state.limit;
    const pageRows = filtered.slice(start, start + state.limit);

    const tbody = $('#td-tbody');
    const cards = $('#td-cards');
    if (pageRows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="td-empty">' + icon('search-x', 'td-ic-20') + '<span>No test runs match your filters.</span></td></tr>';
      cards.innerHTML = '<div class="td-empty">' + icon('search-x', 'td-ic-20') + '<span>No test runs match your filters.</span></div>';
    } else {
      tbody.innerHTML = pageRows.map(runRowHTML).join('');
      cards.innerHTML = pageRows.map(runCardHTML).join('');
    }

    $('#td-page-info').textContent = 'Page ' + state.page + ' of ' + pages;
    $('#td-total').textContent = filtered.length + ' total';
    $('#td-prev').disabled = state.page <= 1;
    $('#td-next').disabled = state.page >= pages;

    // compteur de filtres actifs
    const active = state.statuses.size + state.branches.size + state.envs.size + state.cis.size + state.tags.size;
    const moreBtn = $('#f-more');
    moreBtn.querySelector('.td-filter-count').textContent = (state.envs.size + state.cis.size) || '';
    moreBtn.querySelector('.td-filter-count').style.display = (state.envs.size + state.cis.size) ? 'inline-flex' : 'none';

    refreshIcons();
  }

  /* ---------- popovers ---------- */
  function closeAllPopovers(except) {
    $$('.td-pop').forEach(function (p) { if (p !== except) p.classList.remove('is-open'); });
    $$('[data-pop-trigger]').forEach(function (b) { if (!except || b.getAttribute('aria-controls') !== except.id) b.setAttribute('aria-expanded', 'false'); });
  }
  function wirePopovers() {
    $$('[data-pop-trigger]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const pop = document.getElementById(btn.getAttribute('aria-controls'));
        const open = pop.classList.contains('is-open');
        closeAllPopovers();
        if (!open) { pop.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true'); }
      });
    });
    document.addEventListener('click', function () { closeAllPopovers(); });
    $$('.td-pop-inner').forEach(function (el) { el.addEventListener('click', e => e.stopPropagation()); });
  }

  function optionRow(kind, value, label, checked) {
    return '<label class="td-opt"><input type="checkbox" data-kind="' + kind + '" value="' + esc(value) + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="td-opt-label">' + esc(label) + '</span></label>';
  }

  function buildFilterMenus() {
    const f = DATA.filters;
    $('#menu-status').innerHTML = '<div class="td-pop-inner">' + f.statuses.map(s => {
      const sm = statusMeta(s);
      return '<label class="td-opt"><input type="checkbox" data-kind="status" value="' + s + '">' +
        '<span class="td-status ' + sm.cls + ' ' + sm.text + ' td-ic-14">' + icon(sm.icon, 'td-ic-12') + '</span>' +
        '<span class="td-opt-label">' + sm.label + '</span></label>';
    }).join('') + '</div>';

    $('#menu-branch').innerHTML = '<div class="td-pop-inner">' + f.branches.map(b => optionRow('branch', b, b, false)).join('') + '</div>';

    $('#menu-tags').innerHTML = '<div class="td-pop-inner td-pop-scroll">' + f.tags.map(t => optionRow('tag', t, t, false)).join('') + '</div>';

    $('#menu-more').innerHTML = '<div class="td-pop-inner td-pop-scroll">' +
      '<div class="td-pop-title">Environment</div>' + f.environments.map(e => optionRow('env', e, envMeta(e).label + ' · ' + e, false)).join('') +
      '<div class="td-pop-sep"></div>' +
      '<div class="td-pop-title">CI provider</div>' + f.ci.map(c => optionRow('ci', c, ciMeta(c).label, false)).join('') +
      '</div>';
  }

  function wireFilterInputs() {
    document.addEventListener('change', function (e) {
      const cb = e.target;
      if (cb.tagName !== 'INPUT' || cb.type !== 'checkbox' || !cb.dataset.kind) return;
      const map = { status: state.statuses, branch: state.branches, env: state.envs, ci: state.cis, tag: state.tags };
      const set = map[cb.dataset.kind];
      if (cb.checked) set.add(cb.value); else set.delete(cb.value);
      state.page = 1;
      render();
    });
  }

  function wirePeriod() {
    const btn = $('#f-period');
    const menu = $('#menu-period');
    menu.innerHTML = '<div class="td-pop-inner">' + Object.keys(PERIOD_LABEL).map(k =>
      '<label class="td-opt td-opt-radio"><input type="radio" name="period" value="' + k + '"' + (k === state.period ? ' checked' : '') + '>' +
      '<span class="td-opt-label">' + PERIOD_LABEL[k] + '</span></label>').join('') + '</div>';
    menu.addEventListener('change', function (e) {
      if (e.target.name !== 'period') return;
      state.period = e.target.value;
      btn.querySelector('.td-filter-label').textContent = PERIOD_LABEL[state.period];
      state.page = 1;
      closeAllPopovers();
      render();
    });
    btn.querySelector('.td-filter-label').textContent = PERIOD_LABEL[state.period];
  }

  /* ---------- run detail drawer ---------- */
  function openDrawer(id) {
    const r = RUNS.find(x => x.id === id);
    if (!r) return;
    const s = statusMeta(r.status);
    const ci = ciMeta(r.ci);
    const res = [['passed', r.passed], ['failed', r.failed], ['flaky', r.flaky], ['skipped', r.skipped], ['interrupted', r.interrupted], ['unknown', r.unknown]];
    const maxTotal = Math.max(1, r.total);
    const body = $('#td-drawer-body');
    body.innerHTML = '' +
      '<div class="td-dr-head">' +
        '<span class="td-status td-status-lg ' + s.cls + ' ' + s.text + '">' + icon(s.icon, 'td-ic-16') + '</span>' +
        '<div><div class="td-dr-title">#' + r.counter + '</div><div class="td-dr-sub">' + s.label + ' · ' + fmtDuration(r.durationMs) + '</div></div>' +
      '</div>' +
      '<div class="td-dr-grid">' +
        '<div class="td-dr-field"><span>Started</span><b>' + new Date(r.startTime).toLocaleString() + '</b></div>' +
        '<div class="td-dr-field"><span>Branch</span><b>' + esc(r.branch || '—') + '</b></div>' +
        '<div class="td-dr-field"><span>Environment</span><b>' + envBadge(r.env) + '</b></div>' +
        '<div class="td-dr-field"><span>CI</span><b>' + icon(ci.icon, 'td-ic-12') + ' ' + esc(ci.label) + '</b></div>' +
        (r.commitHash ? '<div class="td-dr-field td-dr-wide"><span>Commit</span><b><code class="td-hash">' + shortHash(r.commitHash) + '</code> ' + esc(r.commitMessage || '') + '</b></div>' : '') +
        (r.author ? '<div class="td-dr-field"><span>Author</span><b>' + esc(r.author) + '</b></div>' : '') +
        (r.pr ? '<div class="td-dr-field"><span>Pull request</span><b>PR #' + r.pr + '</b></div>' : '') +
      '</div>' +
      '<div class="td-dr-section"><div class="td-dr-section-title">Results</div>' +
        res.map(function (d) {
          const pct = Math.round((d[1] / maxTotal) * 100);
          const v = d[0] === 'unknown' ? 'skipped' : d[0];
          return '<div class="td-dr-bar"><span class="td-dr-bar-label">' + d[0] + '</span>' +
            '<span class="td-dr-bar-track"><span class="td-dr-bar-fill bg-' + v + '" style="width:' + pct + '%"></span></span>' +
            '<span class="td-dr-bar-val">' + d[1] + '</span></div>';
        }).join('') +
      '</div>' +
      '<div class="td-dr-section"><div class="td-dr-section-title">AI Insights</div>' +
        (r.ai ? '<div class="td-dr-ai">' + icon('sparkles', 'td-ic-14') + '<strong>' + r.ai.count + '</strong> ' + esc(r.ai.category) + '</div>' +
          '<p class="td-dr-note">Catégorie dérivée localement (à brancher sur ai.testdino.com).</p>'
          : '<p class="td-dr-note">Aucun insight.</p>') +
      '</div>' +
      ((r.tags && r.tags.length) ? '<div class="td-dr-section"><div class="td-dr-section-title">Tags</div><div class="td-tags">' + r.tags.map(t => '<span class="td-tag">' + esc(t) + '</span>').join('') + '</div></div>' : '');

    const drawer = $('#td-drawer');
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    $('#td-backdrop').classList.add('is-open');
    refreshIcons();
  }
  function closeDrawer() {
    $('#td-drawer').classList.remove('is-open');
    $('#td-drawer').setAttribute('aria-hidden', 'true');
    $('#td-backdrop').classList.remove('is-open');
  }

  /* ---------- command palette (Ctrl+K) ---------- */
  function openPalette() {
    $('#td-palette').classList.add('is-open');
    $('#td-palette-input').value = state.q;
    $('#td-palette-input').focus();
    renderPalette();
    refreshIcons();
  }
  function closePalette() { $('#td-palette').classList.remove('is-open'); }
  function renderPalette() {
    const q = $('#td-palette-input').value.trim().toLowerCase();
    const res = (q ? visibleRuns().filter(function (r) {
      return ('#' + r.counter + ' ' + r.branch + ' ' + r.commitMessage + ' ' + r.author).toLowerCase().indexOf(q) !== -1;
    }) : visibleRuns()).slice(0, 8);
    $('#td-palette-results').innerHTML = res.length ? res.map(function (r) {
      const s = statusMeta(r.status);
      return '<button class="td-pal-item" data-id="' + r.id + '">' +
        '<span class="td-status ' + s.cls + ' ' + s.text + ' td-ic-14">' + icon(s.icon, 'td-ic-12') + '</span>' +
        '<span class="td-pal-main"><b>#' + r.counter + '</b> <span class="td-pal-msg">' + esc(r.commitMessage || '(no commit)') + '</span></span>' +
        '<span class="td-pal-meta">' + esc(r.branch || '') + '</span>' +
      '</button>';
    }).join('') : '<div class="td-pal-empty">Aucun résultat</div>';
    refreshIcons();
  }

  /* ---------- theme ---------- */
  function applyTheme(theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const btn = $('#td-theme');
    if (btn) btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 'td-ic-16');
    try { localStorage.setItem('td-theme', theme); } catch (e) {}
    refreshIcons();
  }
  function initTheme() {
    let t;
    try { t = localStorage.getItem('td-theme'); } catch (e) {}
    if (!t) t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(t);
  }

  /* ---------- sidebar ---------- */
  function toggleSidebar() {
    const app = $('#td-app');
    if (window.innerWidth < 768) {
      app.classList.toggle('sb-mobile-open');
    } else {
      app.classList.toggle('sb-collapsed');
    }
  }

  /* ---------- wiring ---------- */
  function wire() {
    buildFilterMenus();
    wirePeriod();
    wirePopovers();
    wireFilterInputs();

    // lignes / cartes → tiroir
    $('#td-table-area').addEventListener('click', function (e) {
      const row = e.target.closest('.td-row, .td-card');
      if (row && !e.target.closest('a')) openDrawer(row.dataset.id);
    });
    $('#td-table-area').addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('td-row')) { e.preventDefault(); openDrawer(e.target.dataset.id); }
    });

    $('#td-drawer-close').addEventListener('click', closeDrawer);
    $('#td-backdrop').addEventListener('click', function () { closeDrawer(); closePalette(); });

    // pagination
    $('#td-prev').addEventListener('click', function () { if (state.page > 1) { state.page--; render(); } });
    $('#td-next').addEventListener('click', function () { state.page++; render(); });
    $('#td-limit').addEventListener('change', function (e) { state.limit = parseInt(e.target.value, 10); state.page = 1; render(); });

    // refresh
    $('#td-refresh').addEventListener('click', function () {
      const btn = this; btn.classList.add('is-spinning');
      setTimeout(function () { btn.classList.remove('is-spinning'); $('#td-updated').textContent = 'Last updated: Just now'; }, 700);
    });

    // theme + sidebar
    $('#td-theme').addEventListener('click', function () {
      applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark');
    });
    $('#td-sidebar-toggle').addEventListener('click', toggleSidebar);
    $('#td-sidebar-mobile-close').addEventListener('click', function () { $('#td-app').classList.remove('sb-mobile-open'); });
    $('#td-app').addEventListener('click', function (e) {
      if (e.target.id === 'td-sidebar-backdrop') $('#td-app').classList.remove('sb-mobile-open');
    });

    // palette
    $('#td-search').addEventListener('click', openPalette);
    $('#td-palette-input').addEventListener('input', renderPalette);
    $('#td-palette-results').addEventListener('click', function (e) {
      const item = e.target.closest('.td-pal-item');
      if (item) { closePalette(); openDrawer(item.dataset.id); }
    });

    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
      if (e.key === 'Escape') { closePalette(); closeDrawer(); closeAllPopovers(); }
    });

    // nav (état actif)
    $$('#td-nav a').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        $$('#td-nav a').forEach(x => x.classList.remove('is-active'));
        a.classList.add('is-active');
        if (window.innerWidth < 768) $('#td-app').classList.remove('sb-mobile-open');
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    wire();
    render();
  });
})();
