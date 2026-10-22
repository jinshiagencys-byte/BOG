// Formatteurs partagés (durées, temps relatif, hash, initiales)

export function fmtDuration(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return Math.round(ms) + 'ms'
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's'
  const m = Math.floor(ms / 60000)
  const s = Math.round((ms % 60000) / 1000)
  return m + 'm ' + s + 's'
}

export function timeAgo(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const diff = Math.max(0, Date.now() - then)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return 'À l’instant'
  const min = Math.floor(sec / 60)
  if (min < 60) return 'Il y a ' + min + (min === 1 ? ' minute' : ' minutes')
  const hr = Math.floor(min / 60)
  if (hr < 24) return 'Il y a ' + hr + (hr === 1 ? ' heure' : ' heures')
  const d = Math.floor(hr / 24)
  if (d < 7) return 'Il y a ' + d + (d === 1 ? ' jour' : ' jours')
  const w = Math.floor(d / 7)
  if (d < 30) {
    const rd = d % 7
    return (
      'Il y a ' +
      w +
      (w === 1 ? ' semaine' : ' semaines') +
      (rd ? ' et ' + rd + (rd === 1 ? ' jour' : ' jours') : '')
    )
  }
  const mo = Math.floor(d / 30)
  return 'Il y a ' + mo + ' mois'
}

export function shortHash(h) {
  return h ? h.slice(0, 7) : ''
}

export function initials(name) {
  if (!name) return '?'
  const parts = name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
  return ((parts[0] || '?')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase()
}

const AVATAR_PALETTE = ['blue', 'cyan', 'purple', 'rose', 'amber', 'olive', 'magenta']

export function avatarColor(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length]
}

export function fmtPercent(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—'
  return v.toFixed(digits) + '%'
}

export function fmtNumber(n) {
  if (n == null) return '—'
  return n.toLocaleString('fr-FR')
}
