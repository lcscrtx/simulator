// Motor estatístico: forças de ataque/defesa (Poisson com decaimento temporal),
// probabilidades de placar (Dixon-Coles) e simulações Monte Carlo.
// Funções puras: rodam no servidor e no navegador (modo "e se").

export type Rating = { att: number; def: number; n: number };
export type Ratings = { mu: number; home: number; teams: Record<number, Rating> };

type Game = { date: string; home: { id: number }; away: { id: number }; hg: number | null; ag: number | null };

const HALF_LIFE_DAYS = 300;
const PRIOR_WEIGHT = 4; // jogos "fictícios" na média, encolhem times com pouca amostra
// Times sem histórico próprio (aparecem só contra times sincronizados) tendem a ser mais fracos
const UNKNOWN_PRIOR = { att: 0.8, def: 1.2 };

export type FitOptions = { halfLifeDays?: number; priorWeight?: number };

export function fitRatings(games: Game[], knownTeams: number[], now = Date.now(), opts: FitOptions = {}): Ratings {
  const halfLife = opts.halfLifeDays ?? HALF_LIFE_DAYS, priorWeight = opts.priorWeight ?? PRIOR_WEIGHT;
  const known = new Set(knownTeams);
  const w = games.map((g) => Math.pow(0.5, (now - new Date(g.date).getTime()) / 86400000 / halfLife));
  const ids = [...new Set(games.flatMap((g) => [g.home.id, g.away.id]))];
  const prior = (id: number) => (known.has(id) ? { att: 1, def: 1 } : UNKNOWN_PRIOR);
  const teams: Record<number, Rating> = {};
  for (const id of ids) teams[id] = { ...prior(id), n: 0 };

  let sw = 0, sh = 0, sa = 0;
  games.forEach((g, i) => { sw += w[i]; sh += w[i] * g.hg!; sa += w[i] * g.ag!; });
  let mu = sa / sw || 1.1;
  let home = sh / sa || 1.3;

  for (let iter = 0; iter < 40; iter++) {
    const attNum: Record<number, number> = {}, attDen: Record<number, number> = {};
    const defNum: Record<number, number> = {}, defDen: Record<number, number> = {};
    games.forEach((g, i) => {
      const H = teams[g.home.id], A = teams[g.away.id];
      attNum[g.home.id] = (attNum[g.home.id] ?? 0) + w[i] * g.hg!;
      attDen[g.home.id] = (attDen[g.home.id] ?? 0) + w[i] * mu * home * A.def;
      attNum[g.away.id] = (attNum[g.away.id] ?? 0) + w[i] * g.ag!;
      attDen[g.away.id] = (attDen[g.away.id] ?? 0) + w[i] * mu * H.def;
      defNum[g.home.id] = (defNum[g.home.id] ?? 0) + w[i] * g.ag!;
      defDen[g.home.id] = (defDen[g.home.id] ?? 0) + w[i] * mu * A.att;
      defNum[g.away.id] = (defNum[g.away.id] ?? 0) + w[i] * g.hg!;
      defDen[g.away.id] = (defDen[g.away.id] ?? 0) + w[i] * mu * home * H.att;
    });
    for (const id of ids) {
      const p = prior(id);
      const k = priorWeight * mu;
      teams[id].att = (attNum[id] + k * p.att) / (attDen[id] + k);
      teams[id].def = (defNum[id] + k * p.def) / (defDen[id] + k);
      teams[id].n = attDen[id] / mu;
    }
    // normaliza pelos times conhecidos: média de ataque = média de defesa = 1
    const ref = ids.filter((id) => known.has(id));
    if (ref.length) {
      const ma = ref.reduce((s, id) => s + teams[id].att, 0) / ref.length;
      const md = ref.reduce((s, id) => s + teams[id].def, 0) / ref.length;
      for (const id of ids) { teams[id].att /= ma; teams[id].def /= md; }
    }
    let eh = 0, ea = 0;
    games.forEach((g, i) => {
      eh += w[i] * teams[g.home.id].att * teams[g.away.id].def;
      ea += w[i] * teams[g.away.id].att * teams[g.home.id].def;
    });
    mu = sa / ea;
    home = sh / (mu * eh);
  }
  return { mu, home, teams };
}

export function getRating(r: Ratings, id: number): Rating {
  return r.teams[id] ?? { ...UNKNOWN_PRIOR, n: 0 };
}

/** Gols esperados. neutral = campo neutro; adj = multiplicadores do modo "e se". */
export function expectedGoals(
  r: Ratings, homeId: number, awayId: number,
  opts: { neutral?: boolean; adjHome?: Adj; adjAway?: Adj } = {},
): [number, number] {
  const H = getRating(r, homeId), A = getRating(r, awayId);
  const ha = opts.adjHome ?? NO_ADJ, aa = opts.adjAway ?? NO_ADJ;
  // campo neutro: os dois lados recebem metade (geométrica) do fator casa
  // HOME_EXTRA: o ajuste subestimava o mandante; no backtest (scripts/backtest.ts, 1.079 jogos de 2024–26)
  // um reforço de ~4,5% no ataque da casa e o inverso no visitante reduziu o log loss
  const hf = opts.neutral ? Math.sqrt(r.home) : r.home * HOME_EXTRA;
  const af = opts.neutral ? Math.sqrt(r.home) : 1 / HOME_EXTRA;
  return [
    r.mu * hf * H.att * ha.att * A.def * aa.def,
    r.mu * af * A.att * aa.att * H.def * ha.def,
  ];
}

const HOME_EXTRA = 1.045;

export type Adj = { att: number; def: number };
export const NO_ADJ: Adj = { att: 1, def: 1 };

const MAX_GOALS = 10;
const RHO = -0.06; // correção Dixon-Coles para placares baixos (mais empates 0x0/1x1)

function poissonPmf(l: number): number[] {
  const p = [Math.exp(-l)];
  for (let k = 1; k <= MAX_GOALS; k++) p.push((p[k - 1] * l) / k);
  return p;
}

export type MatchProbs = { home: number; draw: number; away: number; matrix: number[][]; xg: [number, number]; top: { h: number; a: number; p: number }[] };

export function matchProbs(lh: number, la: number, rho = RHO): MatchProbs {
  const ph = poissonPmf(lh), pa = poissonPmf(la);
  const matrix: number[][] = [];
  let home = 0, draw = 0, away = 0, total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    matrix.push([]);
    for (let a = 0; a <= MAX_GOALS; a++) {
      let tau = 1;
      if (h === 0 && a === 0) tau = 1 - lh * la * rho;
      else if (h === 0 && a === 1) tau = 1 + lh * rho;
      else if (h === 1 && a === 0) tau = 1 + la * rho;
      else if (h === 1 && a === 1) tau = 1 - rho;
      const p = ph[h] * pa[a] * tau;
      matrix[h].push(p);
      total += p;
    }
  }
  const top: MatchProbs["top"] = [];
  for (let h = 0; h <= MAX_GOALS; h++) for (let a = 0; a <= MAX_GOALS; a++) {
    const p = (matrix[h][a] /= total);
    if (h > a) home += p; else if (h === a) draw += p; else away += p;
    top.push({ h, a, p });
  }
  top.sort((x, y) => y.p - x.p);
  return { home, draw, away, matrix, xg: [lh, la], top: top.slice(0, 6) };
}

// Gerador determinístico para resultados estáveis entre recarregamentos
export function rng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function samplePoisson(l: number, rand: () => number): number {
  const L = Math.exp(-l);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}

export type Row = { id: number; pts: number; w: number; gp: number; gc: number; j: number };

export type SeasonProjection = {
  sims: number;
  teams: { id: number; avgPts: number; title: number; g4: number; g6: number; z4: number; posDist: number[] }[];
};

export function simulateSeason(
  r: Ratings, table: Row[], fixtures: { home: { id: number }; away: { id: number } }[], sims = 10000,
): SeasonProjection {
  const rand = rng(7);
  const n = table.length;
  const idx = new Map(table.map((t, i) => [t.id, i]));
  const xg = fixtures.map((f) => expectedGoals(r, f.home.id, f.away.id));
  const posCount = table.map(() => new Array(n).fill(0));
  const ptsSum = new Array(n).fill(0);
  const pts = new Float64Array(n), w = new Float64Array(n), sg = new Float64Array(n), gp = new Float64Array(n);
  const order = table.map((_, i) => i);

  for (let s = 0; s < sims; s++) {
    table.forEach((t, i) => { pts[i] = t.pts; w[i] = t.w; sg[i] = t.gp - t.gc; gp[i] = t.gp; });
    fixtures.forEach((f, k) => {
      const hi = idx.get(f.home.id), ai = idx.get(f.away.id);
      if (hi == null || ai == null) return;
      const h = samplePoisson(xg[k][0], rand), a = samplePoisson(xg[k][1], rand);
      sg[hi] += h - a; sg[ai] += a - h; gp[hi] += h; gp[ai] += a;
      if (h > a) { pts[hi] += 3; w[hi]++; } else if (h < a) { pts[ai] += 3; w[ai]++; } else { pts[hi]++; pts[ai]++; }
    });
    order.sort((x, y) => pts[y] - pts[x] || w[y] - w[x] || sg[y] - sg[x] || gp[y] - gp[x] || rand() - 0.5);
    order.forEach((ti, pos) => { posCount[ti][pos]++; ptsSum[ti] += pts[ti]; });
  }
  return {
    sims,
    teams: table.map((t, i) => {
      const d = posCount[i].map((c) => c / sims);
      const sum = (a: number, b: number) => d.slice(a, b).reduce((x, y) => x + y, 0);
      return { id: t.id, avgPts: ptsSum[i] / sims, title: d[0], g4: sum(0, 4), g6: sum(0, 6), z4: sum(n - 4, n), posDist: d };
    }),
  };
}

/** Confronto eliminatório. Jogo único ou ida/volta (mandante da ida = a), com placar parcial opcional. */
export function simulateTie(
  r: Ratings, a: number, b: number,
  opts: { twoLegs: boolean; neutralFinal?: boolean; firstLeg?: [number, number]; adjA?: Adj; adjB?: Adj; sims?: number },
) {
  const sims = opts.sims ?? 20000;
  const rand = rng(11);
  const leg1 = expectedGoals(r, a, b, { neutral: !opts.twoLegs && opts.neutralFinal, adjHome: opts.adjA, adjAway: opts.adjB });
  const leg2 = expectedGoals(r, b, a, { adjHome: opts.adjB, adjAway: opts.adjA });
  let winsA = 0, pens = 0;
  for (let s = 0; s < sims; s++) {
    let ga: number, gb: number;
    if (opts.firstLeg) [ga, gb] = opts.firstLeg;
    else { ga = samplePoisson(leg1[0], rand); gb = samplePoisson(leg1[1], rand); }
    if (opts.twoLegs) { gb += samplePoisson(leg2[0], rand); ga += samplePoisson(leg2[1], rand); }
    if (ga > gb) winsA++;
    else if (ga === gb) { pens++; if (rand() < 0.5) winsA++; }
  }
  return { a: winsA / sims, b: 1 - winsA / sims, penalties: pens / sims, leg1: matchProbs(...leg1), leg2: opts.twoLegs ? matchProbs(...leg2) : null };
}

/** Peso heurístico de um jogador ausente sobre ataque/defesa do time. */
export function absenceAdj(players: { pos: string; starts: number; goals: number }[], games: number, teamGoals: number): Adj {
  let att = 1, def = 1;
  for (const p of players) {
    const reg = games ? Math.min(1, p.starts / games) : 0.5;
    const share = teamGoals ? p.goals / teamGoals : 0;
    const pos = p.pos.toUpperCase();
    if (pos === "GOL") def *= 1 + 0.07 * reg;
    else if (pos.startsWith("Z") || pos.startsWith("L")) def *= 1 + 0.04 * reg;
    else if (pos.startsWith("V") || pos.startsWith("M")) { att *= 1 - 0.03 * reg; def *= 1 + 0.02 * reg; }
    else att *= 1 - 0.04 * reg;
    att *= 1 - Math.min(0.2, 0.5 * share);
  }
  return { att, def };
}
