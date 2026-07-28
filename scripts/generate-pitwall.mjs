#!/usr/bin/env node
// Muret des stands — génère assets/generated/pitwall.svg
//
// Fusionne deux sources réelles :
//   · GitHub GraphQL  → mes repos, commits, calendrier de contributions
//   · Jolpica (Ergast) → championnat F1 2026 et calendrier des Grands Prix
//
// Toute source qui tombe est remplacée par FALLBACK : le SVG produit est
// toujours valide, jamais à moitié rendu. Zéro dépendance npm.

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const USER = process.env.GH_USER || 'LaFicelleCmoi'
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const OUT = resolve(process.argv[2] || 'assets/generated/pitwall.svg')

const W = 1000
const H = 620

const C = {
  bg0: '#05060f',
  bg1: '#080c1a',
  panel: '#0b1220',
  line: '#1e293b',
  red: '#e10600',
  cyan: '#22d3ee',
  violet: '#7c3aed',
  text: '#e2e8f0',
  slate: '#94a3b8',
  mute: '#64748b',
  dim: '#334155',
}

// Écuries F1 — teintes de carrosserie 2026 (approximations fidèles au rendu TV)
const TEAM = {
  mercedes: '#00d7b6', ferrari: '#e8002d', mclaren: '#ff8000',
  red_bull: '#3671c6', aston_martin: '#229971', alpine: '#0093cc',
  williams: '#64c4ff', rb: '#6692ff', racing_bulls: '#6692ff',
  haas: '#b6babd', sauber: '#52e252', audi: '#52e252', cadillac: '#c8a55b',
}
const teamColor = (id = '') => TEAM[id] || C.slate

// Noms de GP en français
const GP_FR = {
  'Australian Grand Prix': ['GP D’AUSTRALIE', 'AUS'],
  'Chinese Grand Prix': ['GP DE CHINE', 'CHN'],
  'Japanese Grand Prix': ['GP DU JAPON', 'JPN'],
  'Bahrain Grand Prix': ['GP DE BAHREÏN', 'BHR'],
  'Saudi Arabian Grand Prix': ['GP D’ARABIE SAOUDITE', 'KSA'],
  'Miami Grand Prix': ['GP DE MIAMI', 'USA'],
  'Canadian Grand Prix': ['GP DU CANADA', 'CAN'],
  'Monaco Grand Prix': ['GP DE MONACO', 'MON'],
  'Spanish Grand Prix': ['GP D’ESPAGNE', 'ESP'],
  'Barcelona Grand Prix': ['GP DE BARCELONE', 'ESP'],
  'Austrian Grand Prix': ['GP D’AUTRICHE', 'AUT'],
  'British Grand Prix': ['GP DE GRANDE-BRETAGNE', 'GBR'],
  'Belgian Grand Prix': ['GP DE BELGIQUE', 'BEL'],
  'Hungarian Grand Prix': ['GP DE HONGRIE', 'HUN'],
  'Dutch Grand Prix': ['GP DES PAYS-BAS', 'NED'],
  'Italian Grand Prix': ['GP D’ITALIE', 'ITA'],
  'Azerbaijan Grand Prix': ['GP D’AZERBAÏDJAN', 'AZE'],
  'Singapore Grand Prix': ['GP DE SINGAPOUR', 'SGP'],
  'United States Grand Prix': ['GP DES ÉTATS-UNIS', 'USA'],
  'Mexico City Grand Prix': ['GP DE MEXICO', 'MEX'],
  'São Paulo Grand Prix': ['GP DE SÃO PAULO', 'BRA'],
  'Las Vegas Grand Prix': ['GP DE LAS VEGAS', 'USA'],
  'Qatar Grand Prix': ['GP DU QATAR', 'QAT'],
  'Abu Dhabi Grand Prix': ['GP D’ABU DHABI', 'UAE'],
}
const gpFR = (name) => GP_FR[name] || [name.toUpperCase(), '—']

// Trigrammes façon F1 pour mes repos
const CODE = {
  'LDC-2026-2027-': 'LDC', 'portfolio-fable': 'PFB', 'f1-2026': 'F26',
  cdm: 'CDM', Marioparty: 'MPY', epitech: 'CHT', 'Portfolio.V2': 'PV2',
  LaFicelleCmoi: 'PRO', 'F1-Retro-Game': 'RTG', qr_app: 'QRA',
}
const code = (n) => CODE[n] || n.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase().padEnd(3, 'X')

const LANG = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572a5', HTML: '#e34c26',
  CSS: '#663399', Java: '#b07219', Groovy: '#4298b8', Shell: '#89e051',
  Dockerfile: '#384d54', PLpgSQL: '#336790', PowerShell: '#012456',
}

// ── Repli : dernier état vérifié (28/07/2026, après le GP de Hongrie) ─────────
const FALLBACK = {
  drivers: [
    { pos: 1, code: 'ANT', name: 'Antonelli', team: 'mercedes', pts: 219 },
    { pos: 2, code: 'HAM', name: 'Hamilton', team: 'ferrari', pts: 169 },
    { pos: 3, code: 'RUS', name: 'Russell', team: 'mercedes', pts: 160 },
    { pos: 4, code: 'LEC', name: 'Leclerc', team: 'ferrari', pts: 138 },
  ],
  teams: [
    { pos: 1, name: 'Mercedes', id: 'mercedes', pts: 379 },
    { pos: 2, name: 'Ferrari', id: 'ferrari', pts: 307 },
    { pos: 3, name: 'McLaren', id: 'mclaren', pts: 220 },
  ],
  race: { name: 'GP DES PAYS-BAS', tag: 'NED', circuit: 'Circuit de Zandvoort', date: '2026-08-23', round: 12, total: 22 },
  stale: true,
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const nf = (n) => new Intl.NumberFormat('fr-FR').format(n)

async function jget(url, ms = 12000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { 'user-agent': `${USER}-pitwall` } })
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
      'user-agent': `${USER}-pitwall`,
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

// ── F1 ───────────────────────────────────────────────────────────────────────
async function fetchF1() {
  const season = new Date().getUTCFullYear()
  const base = `https://api.jolpi.ca/ergast/f1/${season}`
  const [ds, cs, rs] = await Promise.all([
    jget(`${base}/driverstandings.json?limit=4`),
    jget(`${base}/constructorstandings.json?limit=3`),
    jget(`${base}/races.json?limit=30`),
  ])

  const dl = ds.MRData.StandingsTable.StandingsLists[0]?.DriverStandings || []
  const drivers = dl.slice(0, 4).map((d) => ({
    pos: +d.position,
    code: d.Driver.code || d.Driver.familyName.slice(0, 3).toUpperCase(),
    name: d.Driver.familyName,
    team: d.Constructors[0]?.constructorId || '',
    pts: +d.points,
  }))

  const cl = cs.MRData.StandingsTable.StandingsLists[0]?.ConstructorStandings || []
  const teams = cl.slice(0, 3).map((c) => ({
    pos: +c.position,
    name: c.Constructor.name,
    id: c.Constructor.constructorId,
    pts: +c.points,
  }))

  const races = rs.MRData.RaceTable.Races || []
  const now = Date.now()
  const upcoming = races.find((r) => new Date(`${r.date}T${r.time || '12:00:00Z'}`).getTime() > now)
  const src = upcoming || races[races.length - 1]
  const [frName, tag] = gpFR(src.raceName)
  const race = {
    name: frName,
    tag,
    circuit: src.Circuit.circuitName,
    date: src.date,
    round: +src.round,
    total: races.length,
    over: !upcoming,
  }

  if (!drivers.length || !teams.length) throw new Error('classements vides')
  return { drivers, teams, race, stale: false }
}

// ── Rendu ────────────────────────────────────────────────────────────────────
function panel(x, y, w, h, title, accent = C.cyan) {
  return `
  <g>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${C.panel}" stroke="${C.line}"/>
    <rect x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${accent}"/>
    <text x="${x + 16}" y="${y + 22}" class="mono lbl" fill="${C.mute}">${esc(title)}</text>
  </g>`
}

function timingTower(gh) {
  const rows = gh.repos.slice(0, 6)
  const lead = rows[0]?.commits || 1
  const now = Date.now()
  let out = panel(20, 68, 462, 300, 'TOUR DE CHRONOS · CLASSÉ AUX COMMITS', C.violet)

  rows.forEach((r, i) => {
    const y = 104 + i * 42
    const first = i === 0
    const days = (now - new Date(r.pushed).getTime()) / 864e5
    // Gomme = fraîcheur du dépôt : tendre (chaud), medium, dure (au frigo)
    const tyre = days < 21 ? { c: C.red, l: 'S' } : days < 120 ? { c: '#eab308', l: 'M' } : { c: '#cbd5e1', l: 'H' }
    const lc = LANG[r.lang] || r.langColor || C.mute
    const gap = first ? nf(r.commits) : `+${nf(lead - r.commits)}`

    out += `
    <g class="row r${i}">
      <rect x="34" y="${y}" width="434" height="34" rx="6" fill="${first ? '#151b31' : '#0e1526'}"/>
      <rect x="34" y="${y}" width="3.5" height="34" rx="1.75" fill="${lc}"/>
      <rect x="44" y="${y + 7}" width="22" height="20" rx="4" fill="${first ? C.violet : C.dim}"/>
      <text x="55" y="${y + 21.5}" text-anchor="middle" class="mono num" font-size="12" font-weight="700" fill="#fff">${i + 1}</text>
      <text x="76" y="${y + 22}" class="mono" font-size="14" font-weight="700" letter-spacing="1.4" fill="${first ? '#fff' : C.text}">${esc(code(r.name))}</text>
      <text x="116" y="${y + 22}" class="sans" font-size="13" fill="${first ? C.text : C.slate}">${esc(r.name.length > 20 ? r.name.slice(0, 19) + '…' : r.name)}</text>
      <circle cx="286" cy="${y + 17}" r="8" fill="none" stroke="${tyre.c}" stroke-width="2.5"/>
      <text x="286" y="${y + 21}" text-anchor="middle" class="mono" font-size="9" font-weight="700" fill="${tyre.c}">${tyre.l}</text>
      <text x="306" y="${y + 22}" class="mono" font-size="11" fill="${C.mute}">${esc((r.lang || '—').slice(0, 9))}</text>
      <text x="458" y="${y + 22}" text-anchor="end" class="mono num" font-size="14" font-weight="700" fill="${first ? C.violet : C.slate}">${gap}</text>
    </g>`
  })

  out += `
    <text x="34" y="358" class="mono" font-size="10" fill="${C.dim}">GOMMES : S = poussé &lt; 3 sem · M &lt; 4 mois · H = au frigo — ÉCART EN COMMITS SUR LE LEADER</text>`
  return out
}

function nextGP(f1) {
  const d = new Date(`${f1.race.date}T12:00:00Z`)
  const left = Math.max(0, Math.ceil((d.getTime() - Date.now()) / 864e5))
  const fdate = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', timeZone: 'UTC' }).toUpperCase()
  const big = f1.race.over ? 'FIN' : left === 0 ? 'AUJ.' : `J-${left}`

  return panel(498, 68, 482, 152, 'PROCHAIN GRAND PRIX · SAISON EN COURS', C.red) + `
    <text x="514" y="${68 + 62}" class="sans" font-size="25" font-weight="800" font-style="italic" fill="#fff">${esc(f1.race.name)}</text>
    <text x="514" y="${68 + 86}" class="sans" font-size="13" fill="${C.slate}">${esc(f1.race.circuit)}</text>
    <text x="514" y="${68 + 108}" class="mono" font-size="11" letter-spacing="1.5" fill="${C.mute}">MANCHE ${f1.race.round}/${f1.race.total} · ${esc(fdate)}</text>
    <g>
      <rect x="838" y="${68 + 34}" width="126" height="86" rx="8" fill="#12091a" stroke="${C.line}"/>
      <text x="901" y="${68 + 56}" text-anchor="middle" class="mono lbl" fill="${C.mute}">DÉPART DANS</text>
      <text x="901" y="${68 + 100}" text-anchor="middle" class="sans cd" font-size="${big.length > 3 ? 30 : 38}" font-weight="800" fill="${C.red}">${esc(big)}</text>
    </g>
    <g class="prog">
      <rect x="514" y="${68 + 126}" width="450" height="5" rx="2.5" fill="#131c30"/>
      <rect x="514" y="${68 + 126}" width="${Math.round((450 * (f1.race.round - 1)) / f1.race.total)}" height="5" rx="2.5" fill="${C.red}"/>
    </g>`
}

function champ(f1) {
  let out = panel(498, 232, 482, 136, 'CHAMPIONNAT PILOTES · DONNÉES F1 RÉELLES', C.cyan)
  const max = f1.drivers[0]?.pts || 1

  f1.drivers.forEach((d, i) => {
    const y = 258 + i * 26
    const tc = teamColor(d.team)
    out += `
    <g class="drv d${i}">
      <text x="516" y="${y + 14}" class="mono num" font-size="12" font-weight="700" fill="${i === 0 ? C.cyan : C.mute}">${d.pos}</text>
      <rect x="532" y="${y + 3}" width="3.5" height="13" rx="1.75" fill="${tc}"/>
      <text x="544" y="${y + 14}" class="mono" font-size="12.5" font-weight="700" letter-spacing="1.2" fill="${i === 0 ? '#fff' : C.text}">${esc(d.code)}</text>
      <text x="586" y="${y + 14}" class="sans" font-size="12" fill="${C.slate}">${esc(d.name)}</text>
      <rect x="700" y="${y + 5}" width="180" height="9" rx="4.5" fill="#131c30"/>
      <rect x="700" y="${y + 5}" width="${Math.max(6, Math.round((180 * d.pts) / max))}" height="9" rx="4.5" fill="${tc}" opacity=".85"/>
      <text x="962" y="${y + 14}" text-anchor="end" class="mono num" font-size="13" font-weight="700" fill="${i === 0 ? '#fff' : C.slate}">${d.pts}</text>
    </g>`
  })

  const t = f1.teams.map((x) => `${x.pos}. ${x.name} ${x.pts}`).join('   ·   ')
  out += `<text x="516" y="360" class="mono" font-size="10.5" fill="${C.dim}">CONSTRUCTEURS — ${esc(t.toUpperCase())}</text>`
  return out
}

function telemetry(gh) {
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

  let out = panel(20, 380, 960, 116, `TRACE DE VITESSE · ${N} DERNIERS JOURS · PIC À ${max} CONTRIBUTIONS/JOUR`, C.cyan) + `
    <line x1="${x0}" y1="${py(avg).toFixed(1)}" x2="${x1}" y2="${py(avg).toFixed(1)}" stroke="${C.dim}" stroke-width="1" stroke-dasharray="4 5"/>
    <text x="${x1}" y="${(py(avg) - 5).toFixed(1)}" text-anchor="end" class="mono" font-size="9" fill="${C.dim}">MOY. ${avg.toFixed(1)}/J</text>
    <path d="${area}" fill="url(#trace)"/>
    <path class="trace" d="${line}" fill="none" stroke="${C.cyan}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <line x1="${x0}" y1="${yb}" x2="${x1}" y2="${yb}" stroke="${C.line}" stroke-width="1"/>`

  if (d[peak]?.contributionCount > 0) {
    out += `
    <g class="pk">
      <circle cx="${px(peak).toFixed(1)}" cy="${py(d[peak].contributionCount).toFixed(1)}" r="3.5" fill="${C.violet}" stroke="${C.bg0}" stroke-width="1.5"/>
      <text x="${px(peak).toFixed(1)}" y="${(py(d[peak].contributionCount) - 9).toFixed(1)}" text-anchor="middle" class="mono" font-size="9" font-weight="700" fill="${C.violet}">MEILLEUR TOUR</text>
    </g>`
  }
  return out
}

function kpis(gh) {
  const t = [
    ['CONTRIBUTIONS · 12 MOIS', nf(gh.year), C.cyan],
    ['JOURS EN PISTE', nf(gh.active), C.violet],
    ['MEILLEUR TOUR · RECORD/JOUR', nf(gh.best), C.red],
    ['DÉPÔTS AU GARAGE', nf(gh.repoTotal), C.text],
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

function render(gh, f1) {
  const stamp = new Date().toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'UTC', hour12: false,
  })
  const alt = `Muret des stands de ${USER} : ${f1.race.name} dans le viseur, ${nf(gh.year)} contributions sur 12 mois, ${gh.repoTotal} dépôts. ${f1.drivers[0]?.name} mène le championnat F1 avec ${f1.drivers[0]?.pts} points.`

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(alt)}">
  <title>${esc(alt)}</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg0}"/>
    </linearGradient>
    <linearGradient id="trace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.cyan}" stop-opacity=".42"/>
      <stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="hdr" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.red}" stop-opacity=".22"/>
      <stop offset=".55" stop-color="${C.violet}" stop-opacity=".10"/>
      <stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="chk" width="16" height="16" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" fill="#94a3b8"/><rect x="8" y="8" width="8" height="8" fill="#94a3b8"/>
    </pattern>
    <clipPath id="hdrclip"><rect x="1" y="1" width="${W - 2}" height="54"/></clipPath>
  </defs>

  <style>
    .mono { font-family: ui-monospace, "Cascadia Code", "SF Mono", Consolas, "Liberation Mono", monospace }
    .sans { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif }
    .num  { font-variant-numeric: tabular-nums }
    .lbl  { font-size: 10.5px; letter-spacing: 1.7px }

    /* Aucun opacity:0 ni dasharray en dur : un moteur qui ignore les
       animations affiche le tableau de bord complet, pas une page blanche. */
    @keyframes fadeup { from { opacity: 0; transform: translateY(9px) } to { opacity: 1; transform: none } }
    @keyframes slidein { from { opacity: 0; transform: translateX(-22px) } to { opacity: 1; transform: none } }
    @keyframes beat { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
    @keyframes draw {
      from { stroke-dasharray: 4000; stroke-dashoffset: 4000 }
      to   { stroke-dasharray: 4000; stroke-dashoffset: 0 }
    }
    @keyframes sweep { from { transform: translateX(-140px) } to { transform: translateX(${W}px) } }

    .row { animation: slidein .5s cubic-bezier(.16,1,.3,1) both }
    .r0 { animation-delay: .10s } .r1 { animation-delay: .17s } .r2 { animation-delay: .24s }
    .r3 { animation-delay: .31s } .r4 { animation-delay: .38s } .r5 { animation-delay: .45s }
    .drv { animation: slidein .5s cubic-bezier(.16,1,.3,1) both }
    .d0 { animation-delay: .30s } .d1 { animation-delay: .37s } .d2 { animation-delay: .44s } .d3 { animation-delay: .51s }
    .kpi { animation: fadeup .5s ease both }
    .k0 { animation-delay: .60s } .k1 { animation-delay: .68s } .k2 { animation-delay: .76s } .k3 { animation-delay: .84s }
    .pk { animation: fadeup .5s ease 1.5s both }
    .live { animation: beat 1.7s ease-in-out infinite }
    .trace { animation: draw 2.1s ease-out .5s both }
    .shine { animation: sweep 5.5s linear 1s infinite }

    @media (prefers-reduced-motion: reduce) {
      .row, .drv, .kpi, .pk, .live, .trace { animation: none }
      .shine { display: none }
    }
  </style>

  <rect width="${W}" height="${H}" rx="16" fill="url(#bg)" stroke="${C.line}" stroke-width="1.5"/>

  <g>
    <rect x="1" y="1" width="${W - 2}" height="54" fill="url(#hdr)"/>
    <g clip-path="url(#hdrclip)" opacity=".5">
      <rect class="shine" x="-140" y="1" width="140" height="54" fill="url(#hdr)"/>
    </g>
    <circle class="live" cx="34" cy="28" r="5" fill="${C.red}"/>
    <text x="50" y="32" class="mono" font-size="12" font-weight="700" letter-spacing="2.2" fill="${C.red}">LIVE</text>
    <text x="96" y="32" class="sans" font-size="16" font-weight="800" font-style="italic" letter-spacing=".6" fill="#fff">MURET DES STANDS</text>
    <text x="270" y="32" class="mono" font-size="11" letter-spacing="1.4" fill="${C.mute}">— TÉLÉMÉTRIE ${esc(USER.toUpperCase())}</text>
    <text x="${W - 24}" y="32" text-anchor="end" class="mono" font-size="10.5" letter-spacing="1.2" fill="${C.dim}">MÀJ ${esc(stamp)} UTC${f1.stale ? ' · F1 EN CACHE' : ''}</text>
    <line x1="1" y1="55" x2="${W - 1}" y2="55" stroke="${C.line}"/>
  </g>

  ${timingTower(gh)}
  ${nextGP(f1)}
  ${champ(f1)}
  ${telemetry(gh)}
  ${kpis(gh)}

  <g opacity=".07"><rect x="20" y="584" width="960" height="14" fill="url(#chk)"/></g>
  <text x="24" y="612" class="mono" font-size="9.5" fill="${C.dim}">GÉNÉRÉ PAR SCRIPTS/GENERATE-PITWALL.MJS · GITHUB ACTIONS · SANS AUCUN SERVICE TIERS</text>
  <text x="${W - 24}" y="612" text-anchor="end" class="mono" font-size="9.5" fill="${C.dim}">DONNÉES : API GITHUB + JOLPICA F1</text>
</svg>
`
}

// ── main ─────────────────────────────────────────────────────────────────────
const [ghRes, f1Res] = await Promise.allSettled([fetchGitHub(), fetchF1()])

if (ghRes.status === 'rejected') {
  console.error('✖ GitHub injoignable, rien de fiable à rendre :', ghRes.reason?.message)
  process.exit(1)
}
if (f1Res.status === 'rejected') {
  console.warn('⚠ F1 injoignable, repli sur le dernier état connu :', f1Res.reason?.message)
}

const gh = ghRes.value
const f1 = f1Res.status === 'fulfilled' ? f1Res.value : FALLBACK

await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, render(gh, f1), 'utf8')

console.log(`✓ ${OUT}`)
console.log(`  ${gh.repos.length} dépôts actifs · ${gh.year} contributions/12 mois · ${gh.active} jours en piste`)
console.log(`  F1 : ${f1.race.name} (manche ${f1.race.round}/${f1.race.total}) · leader ${f1.drivers[0]?.name} ${f1.drivers[0]?.pts} pts${f1.stale ? ' [cache]' : ''}`)
