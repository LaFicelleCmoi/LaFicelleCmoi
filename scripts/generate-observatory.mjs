#!/usr/bin/env node
// L'observatoire — génère dist/observatory.svg
//
// Fusionne des sources réelles :
//   · GitHub GraphQL     → mes repos, commits, calendrier de contributions
//   · Launch Library 2   → prochains lancements orbitaux, humains en orbite
//   · la mécanique céleste → phase de la Lune, calculée ici, sans API
//
// Si Launch Library tombe, le panneau l'annonce proprement au lieu d'afficher
// un lancement déjà parti. Si GitHub tombe, rien n'est écrit : la dernière
// version valide reste en ligne. Zéro dépendance npm.

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const USER = process.env.GH_USER || 'LaFicelleCmoi'
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const OUT = resolve(process.argv[2] || 'dist/observatory.svg')
const TZ = 'Europe/Paris'

const W = 1000
const H = 620

const C = {
  bg0: '#05060f',
  bg1: '#0a0b1e',
  panel: '#0b1220',
  line: '#1e293b',
  pink: '#f472b6',
  cyan: '#22d3ee',
  violet: '#7c3aed',
  lilac: '#a78bfa',
  gold: '#fbbf24',
  green: '#22c55e',
  text: '#e2e8f0',
  slate: '#94a3b8',
  mute: '#64748b',
  dim: '#334155',
}

const LANG = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572a5', HTML: '#e34c26',
  CSS: '#663399', Java: '#b07219', Groovy: '#4298b8', Shell: '#89e051',
  Dockerfile: '#384d54', PLpgSQL: '#336790', PowerShell: '#012456',
  Swift: '#f05138', Kotlin: '#a97bff', Dart: '#00b4ab',
}

const SHORT = { JavaScript: 'JS', TypeScript: 'TS', PowerShell: 'PS', Dockerfile: 'Docker', PLpgSQL: 'SQL' }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const nf = (n) => new Intl.NumberFormat('fr-FR').format(n)
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

// Générateur pseudo-aléatoire déterministe : le ciel étoilé ne bouge pas
// d'un rendu à l'autre, seul le contenu change dans le diff.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function jget(url, ms = 15000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'user-agent': `${USER}-observatory` } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

// ── GitHub ───────────────────────────────────────────────────────────────────
async function fetchGitHub() {
  const to = new Date()
  const from = new Date(to.getTime() - 364 * 864e5)
  const q = `query($u:String!,$f:DateTime!,$t:DateTime!){
    user(login:$u){
      followers{totalCount}
      repositories(first:100,ownerAffiliations:OWNER,isFork:false){
        totalCount
        nodes{
          name stargazerCount pushedAt
          primaryLanguage{name color}
          defaultBranchRef{target{... on Commit{history{totalCount}}}}
        }
      }
      contributionsCollection(from:$f,to:$t){
        totalCommitContributions
        contributionCalendar{
          totalContributions
          weeks{contributionDays{date contributionCount}}
        }
      }
    }
  }`
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: `bearer ${TOKEN}`,
      'content-type': 'application/json',
      'user-agent': `${USER}-observatory`,
    },
    body: JSON.stringify({ query: q, variables: { u: USER, f: from.toISOString(), t: to.toISOString() } }),
  })
  const j = await r.json()
  if (j.errors) throw new Error(j.errors.map((e) => e.message).join('; '))
  const u = j.data.user

  const repos = u.repositories.nodes
    .map((n) => ({
      name: n.name,
      stars: n.stargazerCount,
      pushed: n.pushedAt,
      lang: n.primaryLanguage?.name || null,
      langColor: n.primaryLanguage?.color || C.mute,
      commits: n.defaultBranchRef?.target?.history?.totalCount || 0,
    }))
    .filter((r) => r.name !== USER && r.commits > 0)
    .sort((a, b) => b.commits - a.commits)

  const days = u.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .filter((d) => new Date(d.date) <= to)

  return {
    repos,
    days,
    followers: u.followers.totalCount,
    repoTotal: u.repositories.totalCount,
    year: u.contributionsCollection.contributionCalendar.totalContributions,
    commits: u.contributionsCollection.totalCommitContributions,
    active: days.filter((d) => d.contributionCount > 0).length,
    best: Math.max(0, ...days.map((d) => d.contributionCount)),
  }
}

// ── Espace ───────────────────────────────────────────────────────────────────
const LL2 = 'https://ll.thespacedevs.com/2.3.0'

async function fetchLaunches() {
  const j = await jget(`${LL2}/launches/upcoming/?limit=8&mode=normal`)
  const now = Date.now()
  const list = (j.results || [])
    .filter((l) => new Date(l.net).getTime() > now)
    .map((l) => {
      const [rocket, mission] = l.name.split(' | ')
      return {
        rocket: l.rocket?.configuration?.name || rocket,
        mission: mission || l.mission?.name || rocket,
        provider: l.launch_service_provider?.name || '—',
        pad: l.pad?.location?.name || l.pad?.name || '—',
        orbit: l.mission?.orbit?.abbrev || null,
        status: l.status?.abbrev || 'TBD',
        net: l.net,
      }
    })
  if (!list.length) throw new Error('aucun lancement à venir')
  return list
}

async function fetchCrew() {
  const j = await jget(`${LL2}/astronauts/?in_space=true&limit=1&mode=list`)
  if (typeof j.count !== 'number') throw new Error('réponse inattendue')
  return j.count
}

// Phase de la Lune — référence : nouvelle lune du 6 janvier 2000, 18 h 14 UTC.
function moon(date = new Date()) {
  const SYN = 29.530588853
  const ref = Date.UTC(2000, 0, 6, 18, 14)
  const age = ((((date.getTime() - ref) / 864e5) % SYN) + SYN) % SYN
  const p = age / SYN
  const illum = (1 - Math.cos(2 * Math.PI * p)) / 2
  // Les phases « instantanées » (quartiers, pleine et nouvelle lune) ne
  // valent qu'un jour ou deux autour de leur date exacte.
  const near = (x) => Math.abs(p - x) < 0.034
  const name =
    near(0) || near(1) ? 'NOUVELLE LUNE' : near(0.25) ? 'PREMIER QUARTIER' :
    near(0.5) ? 'PLEINE LUNE' : near(0.75) ? 'DERNIER QUARTIER' :
    p < 0.25 ? 'PREMIER CROISSANT' : p < 0.5 ? 'GIBBEUSE CROISSANTE' :
    p < 0.75 ? 'GIBBEUSE DÉCROISSANTE' : 'DERNIER CROISSANT'
  // Plus la Lune éclaire, plus les galaxies et nébuleuses pâlissent.
  const sky =
    illum < 0.25 ? ['EXCELLENT', C.green] :
    illum < 0.55 ? ['BON', C.cyan] :
    illum < 0.85 ? ['MOYEN', C.gold] : ['LUNE ÉBLOUISSANTE', C.pink]
  return { age, p, illum, name, sky }
}

// ── Rendu ────────────────────────────────────────────────────────────────────
function stars(n, x, y, w, h, seed, cls = '') {
  const r = rng(seed)
  let out = ''
  for (let i = 0; i < n; i++) {
    const sx = (x + r() * w).toFixed(1)
    const sy = (y + r() * h).toFixed(1)
    const big = r() > 0.92
    const rad = big ? 1.3 : 0.4 + r() * 0.6
    const op = (big ? 0.8 : 0.18 + r() * 0.4).toFixed(2)
    const tw = cls && big ? ` class="${cls} t${i % 3}"` : ''
    out += `<circle cx="${sx}" cy="${sy}" r="${rad.toFixed(2)}" fill="#fff" opacity="${op}"${tw}/>`
  }
  return out
}

function panel(x, y, w, h, title, accent = C.cyan) {
  return `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${C.panel}" stroke="${C.line}"/>
    <rect x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${accent}"/>
    <text x="${x + 16}" y="${y + 22}" class="mono lbl" fill="${C.mute}">${esc(title)}</text>
  </g>`
}

function catalog(gh) {
  const rows = gh.repos.slice(0, 6)
  const lead = rows[0]?.commits || 1
  const now = Date.now()
  let out = panel(20, 68, 462, 300, 'CATALOGUE · MES OBJETS CLASSÉS PAR ÉCLAT', C.violet)

  rows.forEach((r, i) => {
    const y = 104 + i * 42
    const first = i === 0
    const days = (now - new Date(r.pushed).getTime()) / 864e5
    // Classe spectrale = fraîcheur : O bleue et brûlante, G solaire, M refroidie
    const cls = days < 21 ? { c: '#9bb0ff', l: 'O' } : days < 120 ? { c: C.gold, l: 'G' } : { c: '#ff8a5c', l: 'M' }
    const lc = LANG[r.lang] || r.langColor || C.mute
    const bar = Math.max(4, Math.round((76 * r.commits) / lead))

    out += `
    <g class="row r${i}">
      <rect x="34" y="${y}" width="434" height="34" rx="6" fill="${first ? '#141634' : '#0e1526'}"/>
      <rect x="34" y="${y}" width="3.5" height="34" rx="1.75" fill="${lc}"/>
      <text x="48" y="${y + 21.5}" class="mono" font-size="10.5" font-weight="700" letter-spacing="1" fill="${first ? C.lilac : C.mute}">LC ${i + 1}</text>
      <text x="94" y="${y + 22}" class="sans" font-size="13.5" font-weight="${first ? 700 : 400}" fill="${first ? '#fff' : C.text}">${esc(cut(r.name, 21))}</text>
      <circle cx="262" cy="${y + 17}" r="8" fill="${cls.c}" fill-opacity=".14" stroke="${cls.c}" stroke-width="1.6"/>
      <text x="262" y="${y + 21}" text-anchor="middle" class="mono" font-size="9" font-weight="700" fill="${cls.c}">${cls.l}</text>
      <text x="278" y="${y + 21.5}" class="mono" font-size="10.5" fill="${C.mute}">${esc(SHORT[r.lang] || (r.lang || '—').slice(0, 7))}</text>
      <rect x="330" y="${y + 14}" width="76" height="6" rx="3" fill="#131c30"/>
      <rect x="330" y="${y + 14}" width="${bar}" height="6" rx="3" fill="${first ? C.violet : C.dim}"/>
      <text x="458" y="${y + 22}" text-anchor="end" class="mono num" font-size="13" font-weight="700" fill="${first ? C.lilac : C.slate}">${nf(r.commits)}</text>
    </g>`
  })

  out += `
    <text x="34" y="358" class="mono" font-size="10" fill="${C.dim}">CLASSE : O = poussé &lt; 3 sem · G &lt; 4 mois · M = refroidi — ÉCLAT = COMMITS</text>`
  return out
}

function launchPanel(launches) {
  let out = panel(498, 68, 482, 152, 'PROCHAIN LANCEMENT ORBITAL · LAUNCH LIBRARY 2', C.pink)
  if (!launches) {
    return out + `
    <text x="514" y="132" class="sans" font-size="20" font-weight="800" fill="#fff">Liaison descendante coupée</text>
    <text x="514" y="156" class="sans" font-size="13" fill="${C.slate}">Launch Library ne répond pas — nouveau contact au prochain passage.</text>`
  }

  const l = launches[0]
  const t = new Date(l.net)
  const ms = t.getTime() - Date.now()
  const hrs = ms / 36e5
  const big = hrs < 1 ? 'T-0' : hrs < 48 ? `T-${Math.floor(hrs)} H` : `T-${Math.floor(hrs / 24)} J`
  const when = t.toLocaleString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  }).toUpperCase()
  const go = l.status === 'Go'
  const sc = go ? C.green : C.gold
  const next = launches[1]
  const nextTxt = next
    ? `ENSUITE · ${cut(next.rocket, 18)} — ${cut(next.mission, 28)} · ${new Date(next.net).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: TZ })}`
    : ''

  out += `
    <text x="514" y="${68 + 58}" class="sans" font-size="21" font-weight="800" fill="#fff">${esc(cut(l.mission, 28))}</text>
    <text x="514" y="${68 + 80}" class="sans" font-size="13" fill="${C.slate}">${esc(cut(`${l.rocket} · ${l.provider}`, 44))}</text>
    <text x="514" y="${68 + 100}" class="mono" font-size="10.5" letter-spacing="1" fill="${C.mute}">${esc(cut(l.pad.toUpperCase(), 46))}</text>
    <text x="514" y="${68 + 116}" class="mono" font-size="10.5" letter-spacing="1" fill="${C.mute}">${esc(when)} · PARIS${l.orbit ? ` · ORBITE ${esc(l.orbit.toUpperCase())}` : ''}</text>
    <g>
      <rect x="838" y="${68 + 34}" width="126" height="86" rx="8" fill="#170a1f" stroke="${C.line}"/>
      <text x="901" y="${68 + 54}" text-anchor="middle" class="mono lbl" fill="${C.mute}">DÉCOLLAGE</text>
      <text x="901" y="${68 + 88}" text-anchor="middle" class="sans cd" font-size="${big.length > 5 ? 25 : 30}" font-weight="800" fill="${C.pink}">${esc(big)}</text>
      <circle class="live" cx="${go ? 884 : 870}" cy="${68 + 106}" r="3" fill="${sc}"/>
      <text x="${go ? 892 : 878}" y="${68 + 109.5}" class="mono" font-size="9.5" font-weight="700" letter-spacing="1" fill="${sc}">${go ? 'GO' : 'À CONFIRMER'}</text>
    </g>
    <text x="514" y="${68 + 140}" class="mono" font-size="9.5" fill="${C.dim}">${esc(nextTxt.toUpperCase())}</text>`
  return out
}

function moonDisk(cx, cy, r, m) {
  const k = Math.abs(Math.cos(2 * Math.PI * m.p))
  const waxing = m.p < 0.5
  const gibbous = m.p > 0.25 && m.p < 0.75
  const outer = waxing ? 1 : 0
  const term = waxing ? (gibbous ? 1 : 0) : (gibbous ? 0 : 1)
  const lit = `M${cx},${cy - r} A${r},${r} 0 0 ${outer} ${cx},${cy + r} A${(r * k).toFixed(2)},${r} 0 0 ${term} ${cx},${cy - r} Z`
  return `
    <circle cx="${cx}" cy="${cy}" r="${r + 9}" fill="url(#halo)" opacity="${(0.25 + m.illum * 0.6).toFixed(2)}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#1a2036"/>
    <path d="${lit}" fill="url(#lune)"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2b3550" stroke-width="1"/>`
}

function skyPanel(m, crew) {
  let out = panel(498, 232, 482, 136, 'LE CIEL CE SOIR · CALCULÉ, PAS TÉLÉCHARGÉ', C.cyan)
  out += moonDisk(552, 306, 30, m)
  out += `
    <text x="602" y="282" class="mono" font-size="12" font-weight="700" letter-spacing="1.4" fill="#fff">${esc(m.name)}</text>
    <text x="602" y="302" class="sans" font-size="12.5" fill="${C.slate}">Éclairée à ${Math.round(m.illum * 100)} % · ${m.age.toFixed(1).replace('.', ',')} jours</text>
    <text x="602" y="328" class="mono lbl" fill="${C.mute}">CIEL PROFOND</text>
    <text x="602" y="348" class="mono" font-size="13" font-weight="700" letter-spacing="1.2" fill="${m.sky[1]}">${esc(m.sky[0])}</text>
    <line x1="808" y1="262" x2="808" y2="352" stroke="${C.line}"/>
    <text x="824" y="282" class="mono lbl" fill="${C.mute}">HUMAINS EN ORBITE</text>
    <text x="824" y="330" class="sans" font-size="40" font-weight="800" fill="${C.cyan}">${crew == null ? '—' : crew}</text>
    <text x="824" y="350" class="mono" font-size="9.5" fill="${C.dim}">EN CE MOMENT, LÀ-HAUT</text>`
  return out
}

function lightCurve(gh) {
  const N = 60
  const d = gh.days.slice(-N)
  const x0 = 34, x1 = 966, yb = 478, ht = 60
  const max = Math.max(1, ...d.map((v) => v.contributionCount))
  const px = (i) => x0 + (i * (x1 - x0)) / Math.max(1, d.length - 1)
  const py = (v) => yb - (v / max) * ht

  const pts = d.map((v, i) => `${px(i).toFixed(1)},${py(v.contributionCount).toFixed(1)}`)
  const line = `M${pts.join(' L')}`
  const area = `${line} L${x1},${yb} L${x0},${yb} Z`
  const avg = d.reduce((s, v) => s + v.contributionCount, 0) / Math.max(1, d.length)
  const peak = d.reduce((b, v, i) => (v.contributionCount > d[b].contributionCount ? i : b), 0)

  let out = panel(20, 380, 960, 116, `COURBE DE LUMIÈRE · ${N} DERNIÈRES NUITS · PIC À ${max} CONTRIBUTIONS/JOUR`, C.lilac) + `
    <line x1="${x0}" y1="${py(avg).toFixed(1)}" x2="${x1}" y2="${py(avg).toFixed(1)}" stroke="${C.dim}" stroke-width="1" stroke-dasharray="4 5"/>
    <text x="${x0}" y="${(py(avg) - 5).toFixed(1)}" class="mono" font-size="9" fill="${C.dim}">MOY. ${avg.toFixed(1)}/J</text>
    <path d="${area}" fill="url(#curve)"/>
    <path class="trace" d="${line}" fill="none" stroke="url(#curveStroke)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="${x0}" y1="${yb}" x2="${x1}" y2="${yb}" stroke="${C.line}" stroke-width="1"/>`

  if (d[peak]?.contributionCount > 0) {
    const cx = px(peak).toFixed(1), cy = py(d[peak].contributionCount).toFixed(1)
    out += `
    <g class="pk">
      <circle cx="${cx}" cy="${cy}" r="7" fill="${C.pink}" opacity=".25"/>
      <circle cx="${cx}" cy="${cy}" r="3.2" fill="${C.pink}" stroke="${C.bg0}" stroke-width="1.5"/>
      <text x="${(+cx + 11).toFixed(1)}" y="${(+cy + 3).toFixed(1)}" class="mono" font-size="9" font-weight="700" fill="${C.pink}">SURSAUT</text>
    </g>`
  }
  return out
}

function kpis(gh) {
  const t = [
    ['PHOTONS CAPTÉS · 12 MOIS', nf(gh.year), C.cyan],
    ['NUITS D’OBSERVATION', nf(gh.active), C.lilac],
    ['SURSAUT RECORD · /JOUR', nf(gh.best), C.pink],
    ['OBJETS CATALOGUÉS', nf(gh.repoTotal), C.text],
  ]
  return t
    .map(([l, v, c], i) => {
      const x = 20 + i * 243.5
      return `
    <g class="kpi k${i}">
      <rect x="${x}" y="508" width="226" height="62" rx="9" fill="${C.panel}" stroke="${C.line}"/>
      <text x="${x + 16}" y="530" class="mono lbl" fill="${C.mute}">${esc(l)}</text>
      <text x="${x + 16}" y="558" class="sans" font-size="24" font-weight="800" fill="${c}">${esc(v)}</text>
    </g>`
    })
    .join('')
}

function render(gh, launches, crew, m) {
  const stamp = new Date().toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false,
  })
  const l = launches?.[0]
  const alt = `Observatoire de ${USER} : ${nf(gh.year)} contributions sur 12 mois, ${gh.repoTotal} dépôts. ` +
    (l ? `Prochain lancement : ${l.mission} sur ${l.rocket}. ` : '') +
    `Lune : ${m.name.toLowerCase()}, éclairée à ${Math.round(m.illum * 100)} %.` +
    (crew != null ? ` ${crew} humains en orbite.` : '')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(alt)}">
  <title>${esc(alt)}</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg0}"/>
    </linearGradient>
    <linearGradient id="curve" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.violet}" stop-opacity=".45"/>
      <stop offset="1" stop-color="${C.violet}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="curveStroke" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.cyan}"/><stop offset=".6" stop-color="${C.lilac}"/><stop offset="1" stop-color="${C.pink}"/>
    </linearGradient>
    <linearGradient id="hdr" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.violet}" stop-opacity=".28"/>
      <stop offset=".55" stop-color="${C.pink}" stop-opacity=".08"/>
      <stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="lune" cx=".4" cy=".35" r=".75">
      <stop offset="0" stop-color="#f8fafc"/><stop offset="1" stop-color="#b8c0d6"/>
    </radialGradient>
    <radialGradient id="halo">
      <stop offset=".6" stop-color="#e2e8f0" stop-opacity=".35"/><stop offset="1" stop-color="#e2e8f0" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="hdrclip"><rect x="1" y="1" width="${W - 2}" height="54"/></clipPath>
  </defs>

  <style>
    .mono { font-family: ui-monospace, "Cascadia Code", "SF Mono", Consolas, "Liberation Mono", monospace }
    .sans { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif }
    .num  { font-variant-numeric: tabular-nums }
    .lbl  { font-size: 10.5px; letter-spacing: 1.7px }

    /* Aucun opacity:0 ni dasharray en dur : un moteur qui ignore les
       animations affiche l'observatoire complet, pas un ciel vide. */
    @keyframes fadeup { from { opacity: 0; transform: translateY(9px) } to { opacity: 1; transform: none } }
    @keyframes slidein { from { opacity: 0; transform: translateX(-22px) } to { opacity: 1; transform: none } }
    @keyframes beat { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
    @keyframes twinkle { 0%,100% { opacity: .85 } 50% { opacity: .15 } }
    @keyframes draw {
      from { stroke-dasharray: 4000; stroke-dashoffset: 4000 }
      to   { stroke-dasharray: 4000; stroke-dashoffset: 0 }
    }
    @keyframes sweep { from { transform: translateX(-140px) } to { transform: translateX(${W}px) } }

    .row { animation: slidein .5s cubic-bezier(.16,1,.3,1) both }
    .r0 { animation-delay: .10s } .r1 { animation-delay: .17s } .r2 { animation-delay: .24s }
    .r3 { animation-delay: .31s } .r4 { animation-delay: .38s } .r5 { animation-delay: .45s }
    .kpi { animation: fadeup .5s ease both }
    .k0 { animation-delay: .60s } .k1 { animation-delay: .68s } .k2 { animation-delay: .76s } .k3 { animation-delay: .84s }
    .pk { animation: fadeup .5s ease 1.5s both }
    .live { animation: beat 1.7s ease-in-out infinite }
    .tw { animation: twinkle 3.2s ease-in-out infinite }
    .t1 { animation-delay: 1.1s } .t2 { animation-delay: 2.2s }
    .trace { animation: draw 2.1s ease-out .5s both }
    .shine { animation: sweep 6s linear 1s infinite }

    @media (prefers-reduced-motion: reduce) {
      .row, .kpi, .pk, .live, .tw, .trace { animation: none }
      .shine { display: none }
    }
  </style>

  <rect width="${W}" height="${H}" rx="16" fill="url(#bg)" stroke="${C.line}" stroke-width="1.5"/>
  <g>${stars(140, 6, 58, W - 12, H - 70, 42, 'tw')}</g>

  <g>
    <rect x="1" y="1" width="${W - 2}" height="54" fill="url(#hdr)"/>
    <g clip-path="url(#hdrclip)" opacity=".5">
      <rect class="shine" x="-140" y="1" width="140" height="54" fill="url(#hdr)"/>
      ${stars(40, 1, 1, W - 2, 54, 7)}
    </g>
    <circle class="live" cx="34" cy="28" r="5" fill="${C.pink}"/>
    <text x="50" y="32" class="mono" font-size="12" font-weight="700" letter-spacing="2.2" fill="${C.pink}">EN DIRECT</text>
    <text x="140" y="32" class="sans" font-size="16" font-weight="800" letter-spacing="1.2" fill="#fff">L’OBSERVATOIRE</text>
    <text x="306" y="32" class="mono" font-size="11" letter-spacing="1.4" fill="${C.mute}">— JOURNAL DE BORD DE ${esc(USER.toUpperCase())}</text>
    <text x="${W - 24}" y="32" text-anchor="end" class="mono" font-size="10.5" letter-spacing="1.2" fill="${C.dim}">MÀJ ${esc(stamp)} UTC${launches ? '' : ' · LANCEMENTS HORS LIGNE'}</text>
    <line x1="1" y1="55" x2="${W - 1}" y2="55" stroke="${C.line}"/>
  </g>

  ${catalog(gh)}
  ${launchPanel(launches)}
  ${skyPanel(m, crew)}
  ${lightCurve(gh)}
  ${kpis(gh)}

  <path d="M20,592 Q500,578 980,592" fill="none" stroke="${C.line}" stroke-width="1" stroke-dasharray="2 6"/>
  <text x="24" y="612" class="mono" font-size="9.5" fill="${C.dim}">GÉNÉRÉ PAR SCRIPTS/GENERATE-OBSERVATORY.MJS · GITHUB ACTIONS · SANS AUCUN SERVICE TIERS</text>
  <text x="${W - 24}" y="612" text-anchor="end" class="mono" font-size="9.5" fill="${C.dim}">DONNÉES : API GITHUB + LAUNCH LIBRARY 2 + MÉCANIQUE CÉLESTE</text>
</svg>
`
}

// ── main ─────────────────────────────────────────────────────────────────────
const [ghRes, lRes, cRes] = await Promise.allSettled([fetchGitHub(), fetchLaunches(), fetchCrew()])

if (ghRes.status === 'rejected') {
  console.error('✖ GitHub injoignable, rien de fiable à rendre :', ghRes.reason?.message)
  process.exit(1)
}
if (lRes.status === 'rejected') console.warn('⚠ Lancements injoignables :', lRes.reason?.message)
if (cRes.status === 'rejected') console.warn('⚠ Équipage injoignable :', cRes.reason?.message)

const gh = ghRes.value
const launches = lRes.status === 'fulfilled' ? lRes.value : null
const crew = cRes.status === 'fulfilled' ? cRes.value : null
const m = moon()

await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, render(gh, launches, crew, m), 'utf8')

console.log(`✓ ${OUT}`)
console.log(`  ${gh.repos.length} dépôts actifs · ${gh.year} contributions/12 mois · ${gh.active} nuits d'observation`)
console.log(`  Lancement : ${launches ? `${launches[0].mission} (${launches[0].rocket}) ${launches[0].net}` : 'hors ligne'}`)
console.log(`  Lune : ${m.name} ${Math.round(m.illum * 100)} % · ${crew ?? '?'} humains en orbite`)
