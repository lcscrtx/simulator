// Camada servidor: junta banco + motor e memoriza resultados caros.
import { getDb, type Db, type Match, type Team } from "./data";
import { fitRatings, simulateSeason, expectedGoals, matchProbs, type Ratings, type Row, type SeasonProjection } from "./model";

const memo = new WeakMap<Db, { ratings?: Ratings; table?: TableRow[]; projection?: SeasonProjection }>();
const slot = (db: Db) => memo.get(db) ?? (memo.set(db, {}), memo.get(db)!);

export const SERIE_A = "campeonato-brasileiro";

export function ratings(db = getDb()): Ratings {
  const s = slot(db);
  if (!s.ratings) {
    const cutoff = new Date(Date.now() - 4 * 365 * 86400000).toISOString();
    s.ratings = fitRatings(db.matches.filter((m) => m.date >= cutoff), db.serieATeams);
  }
  return s.ratings;
}

export type TableRow = Row & { team: Team; e: number; d: number; form: string[] };

/** Classificação da temporada atual calculada a partir dos jogos finalizados. */
export function table(db = getDb()): TableRow[] {
  const s = slot(db);
  if (s.table) return s.table;
  const rows = new Map<number, TableRow>();
  for (const id of db.serieATeams) rows.set(id, { id, team: db.teams.get(id)!, pts: 0, w: 0, e: 0, d: 0, gp: 0, gc: 0, j: 0, form: [] });
  const games = db.matches.filter((m) => m.comp === SERIE_A && new Date(m.date).getFullYear() === db.season);
  for (const m of games) {
    const h = rows.get(m.home.id), a = rows.get(m.away.id);
    if (!h || !a) continue;
    h.j++; a.j++; h.gp += m.hg!; h.gc += m.ag!; a.gp += m.ag!; a.gc += m.hg!;
    if (m.hg! > m.ag!) { h.pts += 3; h.w++; a.d++; h.form.push("v"); a.form.push("d"); }
    else if (m.hg! < m.ag!) { a.pts += 3; a.w++; h.d++; a.form.push("v"); h.form.push("d"); }
    else { h.pts++; a.pts++; h.e++; a.e++; h.form.push("e"); a.form.push("e"); }
  }
  // A tabela oficial da API é preferida quando fecha com os jogos restantes (todos terminam com 2×(n−1) jogos)
  const remaining = remainingByTeam(db);
  const total = 2 * (rows.size - 1);
  const official = db.officialTable;
  if (official && official.length === rows.size && official.every((o) => rows.has(o.id) && o.j + (remaining.get(o.id) ?? 0) === total)) {
    for (const o of official) Object.assign(rows.get(o.id)!, { pts: o.pts, w: o.w, e: o.e, d: o.d, gp: o.gp, gc: o.gc, j: o.j });
  }
  s.table = [...rows.values()]
    .map((r) => ({ ...r, form: r.form.slice(-5) }))
    .sort((x, y) => y.pts - x.pts || y.w - x.w || y.gp - y.gc - (x.gp - x.gc) || y.gp - x.gp);
  return s.table;
}

function remainingByTeam(db: Db) {
  const m = new Map<number, number>();
  for (const f of db.fixtures) for (const id of [f.home.id, f.away.id]) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

/** Cada time precisa terminar com 2×(n−1) jogos. Se não fecha, faltam dados e a simulação distorce. */
export function dataQuality(db = getDb()) {
  const remaining = remainingByTeam(db);
  const t = table(db);
  const totals = t.map((r) => r.j + (remaining.get(r.id) ?? 0));
  const expected = 2 * (t.length - 1);
  const bad = t.filter((_, i) => totals[i] !== expected).map((r) => r.team.name);
  return { ok: bad.length === 0, expected, min: Math.min(...totals), max: Math.max(...totals), bad };
}

export function projection(db = getDb()): SeasonProjection {
  const s = slot(db);
  s.projection ??= simulateSeason(ratings(db), table(db), db.fixtures, 10000);
  return s.projection;
}

const result = (m: Match, teamId: number) => {
  const gf = m.home.id === teamId ? m.hg! : m.ag!, ga = m.home.id === teamId ? m.ag! : m.hg!;
  return gf > ga ? "v" : gf < ga ? "d" : "e";
};

export type TeamForm = {
  last: { match: Match; res: string }[];
  venue: { j: number; v: number; e: number; d: number; gp: number; gc: number };
  avgFor: number;
  avgAgainst: number;
  cleanSheets: number;
  failedToScore: number;
};

function teamForm(db: Db, teamId: number, venue: "home" | "away"): TeamForm {
  const all = db.matches.filter((m) => m.home.id === teamId || m.away.id === teamId);
  const recent = all.slice(-10);
  const season = all.filter((m) => m.comp === SERIE_A && new Date(m.date).getFullYear() === db.season && (venue === "home" ? m.home.id : m.away.id) === teamId);
  const v = { j: 0, v: 0, e: 0, d: 0, gp: 0, gc: 0 };
  for (const m of season) {
    const r = result(m, teamId);
    v.j++; v[r as "v" | "e" | "d"]++;
    v.gp += venue === "home" ? m.hg! : m.ag!;
    v.gc += venue === "home" ? m.ag! : m.hg!;
  }
  const gf = (m: Match) => (m.home.id === teamId ? m.hg! : m.ag!);
  const ga = (m: Match) => (m.home.id === teamId ? m.ag! : m.hg!);
  const n = recent.length || 1;
  return {
    last: recent.slice(-5).reverse().map((match) => ({ match, res: result(match, teamId) })),
    venue: v,
    avgFor: recent.reduce((s, m) => s + gf(m), 0) / n,
    avgAgainst: recent.reduce((s, m) => s + ga(m), 0) / n,
    cleanSheets: recent.filter((m) => ga(m) === 0).length / n,
    failedToScore: recent.filter((m) => gf(m) === 0).length / n,
  };
}

export function analyzeMatch(db: Db, m: Match) {
  const r = ratings(db);
  const [lh, la] = expectedGoals(r, m.home.id, m.away.id);
  const probs = matchProbs(lh, la);
  const h2h = db.matches
    .filter((x) => (x.home.id === m.home.id && x.away.id === m.away.id) || (x.home.id === m.away.id && x.away.id === m.home.id))
    .filter((x) => x.id !== m.id)
    .slice(-10)
    .reverse();
  const h2hSum = { home: 0, draw: 0, away: 0 };
  for (const x of h2h) {
    const res = result(x, m.home.id);
    if (res === "v") h2hSum.home++; else if (res === "d") h2hSum.away++; else h2hSum.draw++;
  }
  const home = teamForm(db, m.home.id, "home");
  const away = teamForm(db, m.away.id, "away");
  const tbl = table(db);
  const pos = (id: number) => tbl.findIndex((t) => t.id === id) + 1 || null;

  return {
    probs,
    ratings: { home: r.teams[m.home.id], away: r.teams[m.away.id], mu: r.mu, homeAdv: r.home },
    h2h, h2hSum, home, away,
    position: { home: pos(m.home.id), away: pos(m.away.id) },
    stats: { home: db.teamStats.get(m.home.id) ?? null, away: db.teamStats.get(m.away.id) ?? null },
    factors: keyFactors(m, home, away, h2hSum, h2h.length, probs.xg),
  };
}

const pc = (x: number) => `${Math.round(x * 100)}%`;

function keyFactors(m: Match, home: TeamForm, away: TeamForm, h2h: { home: number; draw: number; away: number }, h2hN: number, xg: [number, number]): string[] {
  const out: string[] = [];
  const formPts = (f: TeamForm) => f.last.reduce((s, x) => s + (x.res === "v" ? 3 : x.res === "e" ? 1 : 0), 0);
  const fh = formPts(home), fa = formPts(away);
  if (Math.abs(fh - fa) >= 4) out.push(`${fh > fa ? m.home.name : m.away.name} chega em melhor fase: ${Math.max(fh, fa)} de 15 pontos nos últimos 5 jogos, contra ${Math.min(fh, fa)}.`);
  if (home.venue.j >= 3) out.push(`${m.home.name} em casa no campeonato: ${home.venue.v}V ${home.venue.e}E ${home.venue.d}D (${(home.venue.gp / home.venue.j).toFixed(1)} gols marcados por jogo).`);
  if (away.venue.j >= 3) out.push(`${m.away.name} fora de casa: ${away.venue.v}V ${away.venue.e}E ${away.venue.d}D (${(away.venue.gc / away.venue.j).toFixed(1)} gols sofridos por jogo).`);
  if (h2hN >= 3) {
    const lead = h2h.home > h2h.away ? m.home.name : h2h.away > h2h.home ? m.away.name : null;
    out.push(lead ? `Retrospecto recente favorece ${lead}: ${h2h.home}V ${h2h.draw}E ${h2h.away}D nos últimos ${h2hN} confrontos.` : `Confronto equilibrado: ${h2h.home}V ${h2h.draw}E ${h2h.away}D nos últimos ${h2hN} jogos.`);
  }
  if (away.cleanSheets >= 0.4) out.push(`${m.away.name} não sofreu gol em ${pc(away.cleanSheets)} dos últimos 10 jogos.`);
  if (home.failedToScore >= 0.4) out.push(`${m.home.name} passou em branco em ${pc(home.failedToScore)} dos últimos 10 jogos.`);
  if (xg[0] + xg[1] >= 3) out.push(`Modelo espera jogo aberto: ${(xg[0] + xg[1]).toFixed(1)} gols no total.`);
  else if (xg[0] + xg[1] <= 2.1) out.push(`Modelo espera jogo truncado: ${(xg[0] + xg[1]).toFixed(1)} gols no total.`);
  return out;
}
