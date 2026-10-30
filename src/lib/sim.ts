// Lógica do simulador interativo: palpites do usuário + Monte Carlo do que falta.
// Puro e sem dependências de servidor: roda no navegador a cada palpite.
import { rng, samplePoisson } from "./model.ts";

export type BaseRow = { id: number; pts: number; w: number; e: number; d: number; gp: number; gc: number; j: number };
export type Fixture = { id: number; round: number; date: string; home: number; away: number };
export type Pick = { h: number; a: number };
export type Picks = Record<number, Pick>;

export type Zone = "lib" | "pre" | "sula" | "z4" | null;
export const zoneOf = (pos: number, n: number): Zone =>
  pos <= 4 ? "lib" : pos <= 6 ? "pre" : pos <= 12 ? "sula" : pos > n - 4 ? "z4" : null;

export type LiveRow = BaseRow & { sg: number };

export type Played = { home: number; away: number; hg: number; ag: number };

const cmp = (a: LiveRow, b: LiveRow) => b.pts - a.pts || b.w - a.w || b.sg - a.sg || b.gp - a.gp;

/** Critérios do Brasileirão: pontos, vitórias, saldo, gols pró e confronto direto (jogos disputados + palpites). */
export function standingsComparator(played: Played[], fixtures: Fixture[], picks: Picks) {
  const h2h = new Map<string, number>(); // pontos de a contra b
  const key = (a: number, b: number) => `${a}:${b}`;
  const add = (h: number, a: number, hg: number, ag: number) => {
    h2h.set(key(h, a), (h2h.get(key(h, a)) ?? 0) + (hg > ag ? 3 : hg === ag ? 1 : 0));
    h2h.set(key(a, h), (h2h.get(key(a, h)) ?? 0) + (ag > hg ? 3 : hg === ag ? 1 : 0));
  };
  for (const m of played) add(m.home, m.away, m.hg, m.ag);
  for (const f of fixtures) { const p = picks[f.id]; if (p) add(f.home, f.away, p.h, p.a); }
  return (a: LiveRow, b: LiveRow) => cmp(a, b) || (h2h.get(key(b.id, a.id)) ?? 0) - (h2h.get(key(a.id, b.id)) ?? 0);
}

/** Tabela com os palpites aplicados (critérios: pontos, vitórias, saldo, gols pró). */
export function liveTable(base: BaseRow[], fixtures: Fixture[], picks: Picks, played: Played[] = []): LiveRow[] {
  const rows = new Map(base.map((r) => [r.id, { ...r, sg: r.gp - r.gc }]));
  for (const f of fixtures) {
    const p = picks[f.id];
    const h = rows.get(f.home), a = rows.get(f.away);
    if (!p || !h || !a) continue;
    h.j++; a.j++;
    h.gp += p.h; h.gc += p.a; h.sg += p.h - p.a;
    a.gp += p.a; a.gc += p.h; a.sg += p.a - p.h;
    if (p.h > p.a) { h.pts += 3; h.w++; a.d++; }
    else if (p.h < p.a) { a.pts += 3; a.w++; h.d++; }
    else { h.pts++; a.pts++; h.e++; a.e++; }
  }
  return [...rows.values()].sort(standingsComparator(played, fixtures, picks));
}

// Índices (0-based) na lista dos OUTROS 19 times que definem cada objetivo do meu time
export const GOALS = {
  titulo: { label: "Ser campeão", k: 0 },
  g4: { label: "Ficar no G4", k: 3 },
  g6: { label: "Vaga na Libertadores (G6)", k: 5 },
  sula: { label: "Vaga na Sul-Americana", k: 11 },
  fuga: { label: "Escapar do rebaixamento", k: 15 },
} as const;
export type GoalKey = keyof typeof GOALS;

export type MonteCarlo = {
  sims: number;
  teams: Map<number, { avgPts: number; posDist: number[]; title: number; g4: number; g6: number; sula: number; z4: number }>;
  free: Fixture[]; // jogos sem palpite (simulados)
  outcomes: Int8Array; // sims × free: 0 casa, 1 empate, 2 fora
  myPos: Int8Array; // posição final do meu time em cada simulação (1-based)
  myPts: Int16Array;
  others: Record<GoalKey, Int16Array>; // pontos do k-ésimo dos outros times em cada simulação
};

export function monteCarlo(
  base: BaseRow[], fixtures: Fixture[], picks: Picks, xg: Map<number, [number, number]>, myTeam: number | null, sims = 4000,
): MonteCarlo {
  const rand = rng(2026);
  const start = liveTable(base, fixtures, picks);
  const n = start.length;
  const idx = new Map(start.map((r, i) => [r.id, i]));
  const free = fixtures.filter((f) => !picks[f.id] && idx.has(f.home) && idx.has(f.away));
  const fh = free.map((f) => idx.get(f.home)!), fa = free.map((f) => idx.get(f.away)!);
  const fx = free.map((f) => xg.get(f.id) ?? [1.3, 1]);
  const outcomes = new Int8Array(sims * free.length);
  const posCount = start.map(() => new Float64Array(n));
  const ptsSum = new Float64Array(n);
  const myIdx = myTeam != null ? idx.get(myTeam) ?? -1 : -1;
  const myPos = new Int8Array(sims), myPts = new Int16Array(sims);
  const others = Object.fromEntries(Object.keys(GOALS).map((k) => [k, new Int16Array(sims)])) as MonteCarlo["others"];

  const pts = new Int32Array(n), w = new Int32Array(n), sg = new Int32Array(n), gp = new Int32Array(n);
  const order = start.map((_, i) => i);
  const tie = new Float64Array(n);
  for (let s = 0; s < sims; s++) {
    start.forEach((r, i) => { pts[i] = r.pts; w[i] = r.w; sg[i] = r.sg; gp[i] = r.gp; tie[i] = rand(); });
    for (let k = 0; k < free.length; k++) {
      const h = samplePoisson(fx[k][0], rand), a = samplePoisson(fx[k][1], rand);
      const hi = fh[k], ai = fa[k];
      sg[hi] += h - a; sg[ai] += a - h; gp[hi] += h; gp[ai] += a;
      if (h > a) { pts[hi] += 3; w[hi]++; outcomes[s * free.length + k] = 0; }
      else if (h < a) { pts[ai] += 3; w[ai]++; outcomes[s * free.length + k] = 2; }
      else { pts[hi]++; pts[ai]++; outcomes[s * free.length + k] = 1; }
    }
    order.sort((x, y) => pts[y] - pts[x] || w[y] - w[x] || sg[y] - sg[x] || gp[y] - gp[x] || tie[y] - tie[x]);
    for (let p = 0; p < n; p++) { posCount[order[p]][p]++; ptsSum[order[p]] += pts[order[p]]; }
    if (myIdx >= 0) {
      myPos[s] = order.indexOf(myIdx) + 1;
      myPts[s] = pts[myIdx];
      let j = 0;
      for (const ti of order) {
        if (ti === myIdx) continue;
        for (const key of Object.keys(GOALS) as GoalKey[]) if (GOALS[key].k === j) others[key][s] = pts[ti];
        j++;
      }
    }
  }
  const teams: MonteCarlo["teams"] = new Map();
  start.forEach((r, i) => {
    const d = [...posCount[i]].map((c) => c / sims);
    const sum = (a: number, b: number) => d.slice(a, b).reduce((x, y) => x + y, 0);
    teams.set(r.id, { avgPts: ptsSum[i] / sims, posDist: d, title: d[0], g4: sum(0, 4), g6: sum(0, 6), sula: sum(6, 12), z4: sum(n - 4, n) });
  });
  return { sims, teams, free, outcomes, myPos, myPts, others };
}

/** Meu time atinge o objetivo nesta simulação? */
export function goalHit(goal: GoalKey, pos: number, n: number) {
  if (goal === "titulo") return pos === 1;
  if (goal === "g4") return pos <= 4;
  if (goal === "g6") return pos <= 6;
  if (goal === "sula") return pos <= 12;
  return pos <= n - 4;
}

export function goalProb(mc: MonteCarlo, goal: GoalKey, n: number) {
  let hit = 0;
  for (let s = 0; s < mc.sims; s++) if (goalHit(goal, mc.myPos[s], n)) hit++;
  return hit / mc.sims;
}

export type KeyGame = { fixture: Fixture; p: [number, number, number]; freq: [number, number, number]; best: 0 | 1 | 2; swing: number };

/** Jogos que mais mexem na chance do meu objetivo: P(objetivo | resultado do jogo). */
export function keyGames(mc: MonteCarlo, goal: GoalKey, n: number, myTeam: number, limit = 5): { mine: KeyGame[]; rivals: KeyGame[] } {
  const F = mc.free.length;
  const out: KeyGame[] = [];
  for (let k = 0; k < F; k++) {
    const f = mc.free[k];
    const hits = [0, 0, 0], cnt = [0, 0, 0];
    for (let s = 0; s < mc.sims; s++) {
      const o = mc.outcomes[s * F + k];
      cnt[o]++;
      if (goalHit(goal, mc.myPos[s], n)) hits[o]++;
    }
    const p = hits.map((h, i) => (cnt[i] >= 30 ? h / cnt[i] : NaN)) as [number, number, number];
    const valid = p.filter((x) => !Number.isNaN(x));
    if (valid.length < 2) continue;
    const best = p.indexOf(Math.max(...valid)) as 0 | 1 | 2;
    const freq = cnt.map((c) => c / mc.sims) as [number, number, number];
    out.push({ fixture: f, p, freq, best, swing: Math.max(...valid) - Math.min(...valid) });
  }
  out.sort((a, b) => b.swing - a.swing);
  const isMine = (g: KeyGame) => g.fixture.home === myTeam || g.fixture.away === myTeam;
  return {
    mine: out.filter(isMine).slice(0, 3),
    // abaixo de ~2 p.p. a diferença é ruído das simulações
    rivals: out.filter((g) => !isMine(g) && g.swing >= 0.02).slice(0, limit),
  };
}

/** Pontos finais para atingir o objetivo com confiança c (pela distribuição dos rivais). */
export function pointsNeeded(mc: MonteCarlo, goal: GoalKey, c: number): number {
  const arr = Array.from(mc.others[goal]).sort((a, b) => a - b);
  // Precisa terminar acima do rival-limite; 1 ponto a mais evita depender dos critérios de desempate
  const q = arr[Math.min(arr.length - 1, Math.floor(c * arr.length))];
  return q + 1;
}

export function momentoLabel(v: number) {
  if (v >= 15) return "voando";
  if (v >= 5) return "em alta";
  if (v <= -15) return "em crise";
  if (v <= -5) return "em baixa";
  return "normal";
}

// ---------- Cenários: preenchem de uma vez os jogos dos outros times ----------

type Probs = { home: number; draw: number; away: number; matrix: number[][] };
type Outcome = 0 | 1 | 2;

export type ScenarioKey = "simular" | "logica" | "realista" | "zebras" | "empates" | "otimista" | "pessimista";
export const SCENARIOS: Record<ScenarioKey, { label: string; icon: string; desc: string; random?: boolean }> = {
  simular: { label: "Deixar o modelo simular", icon: "🎲", desc: "Outros jogos ficam em aberto; as chances consideram todos os resultados possíveis." },
  logica: { label: "Tudo na lógica", icon: "📈", desc: "Favorito claro vence; jogo parelho termina empatado." },
  realista: { label: "Realista", icon: "⚖️", desc: "Um sorteio pelas probabilidades: favoritos vencem a maioria, com algumas surpresas.", random: true },
  zebras: { label: "Rodada de zebras", icon: "🦓", desc: "Muitos azarões vencendo e empatando fora de casa.", random: true },
  empates: { label: "Chuva de empates", icon: "🤝", desc: "Jogos equilibrados terminam empatados; o resto na lógica." },
  otimista: { label: "Cenário otimista", icon: "😁", desc: "Seus rivais diretos rendem um pouco abaixo: vitória vira empate, empate vira derrota." },
  pessimista: { label: "Cenário pessimista", icon: "😰", desc: "Seus rivais diretos rendem um pouco acima: derrota vira empate, empate vira vitória." },
};

/** Placar mais provável dentro de um resultado (casa/empate/fora). */
export function likelyScore(matrix: number[][], outcome: Outcome): Pick {
  let best: Pick = { h: 0, a: 0 }, bp = -1;
  matrix.forEach((row, h) => row.forEach((p, a) => {
    const o = h > a ? 0 : h === a ? 1 : 2;
    if (o === outcome && p > bp) { bp = p; best = { h, a }; }
  }));
  return best;
}

export function favorite(p: Probs): Outcome {
  return p.home >= p.draw && p.home >= p.away ? 0 : p.away >= p.draw ? 2 : 1;
}

function sampleScore(matrix: number[][], rand: () => number): Pick {
  let r = rand();
  for (let h = 0; h < matrix.length; h++) for (let a = 0; a < matrix[h].length; a++) {
    r -= matrix[h][a];
    if (r <= 0) return { h, a };
  }
  return { h: 0, a: 0 };
}

/** Classificação final projetada: jogos sem resultado definido entram pelos pontos esperados
 * (arredondados), então todo time termina com o mesmo número de jogos. */
export function projectedTable(base: BaseRow[], fixtures: Fixture[], picks: Picks, probs: Map<number, Probs>, played: Played[] = []) {
  const t = liveTable(base, fixtures, picks, played);
  const extra = new Map<number, number>(), games = new Map<number, number>();
  const add = (id: number, pts: number) => { extra.set(id, (extra.get(id) ?? 0) + pts); games.set(id, (games.get(id) ?? 0) + 1); };
  for (const f of fixtures) {
    const p = probs.get(f.id);
    if (picks[f.id] || !p) continue;
    add(f.home, 3 * p.home + p.draw);
    add(f.away, 3 * p.away + p.draw);
  }
  const approx = new Set(extra.keys());
  const table = t
    .map((r) => (extra.has(r.id) ? { ...r, pts: r.pts + Math.round(extra.get(r.id)!), j: r.j + games.get(r.id)! } : r))
    .sort(standingsComparator(played, fixtures, picks));
  return { table, approx };
}

/** Pontos esperados ao fim do campeonato (palpites + probabilidades dos jogos em aberto). */
export function expectedFinal(base: BaseRow[], fixtures: Fixture[], picks: Picks, probs: Map<number, Probs>) {
  const exp = new Map(liveTable(base, fixtures, picks).map((r) => [r.id, r.pts]));
  for (const f of fixtures) {
    if (picks[f.id]) continue;
    const p = probs.get(f.id);
    if (!p || !exp.has(f.home) || !exp.has(f.away)) continue;
    exp.set(f.home, exp.get(f.home)! + 3 * p.home + p.draw);
    exp.set(f.away, exp.get(f.away)! + 3 * p.away + p.draw);
  }
  return exp;
}

/** Rivais diretos: os times projetados mais perto da linha do objetivo (ex.: a fronteira do Z4 na luta
 * contra a queda, o 1º lugar na briga pelo título). Sempre devolve os mais próximos. */
export function findRivals(exp: Map<number, number>, myTeam: number, goal: GoalKey, max = 4): number[] {
  const sorted = [...exp.values()].sort((a, b) => b - a);
  const line = GOALS[goal].k + 1; // quantos times atingem o objetivo
  const cut = ((sorted[line - 1] ?? 0) + (sorted[line] ?? sorted[line - 1] ?? 0)) / 2;
  return [...exp]
    .filter(([id]) => id !== myTeam)
    .sort((a, b) => Math.abs(a[1] - cut) - Math.abs(b[1] - cut))
    .slice(0, max)
    .map(([id]) => id);
}

const LOGIC_MIN_WIN = 0.45; // abaixo disso o jogo é parelho e o cenário "lógica" crava empate
const PLAUSIBLE = 0.22; // resultado com pelo menos ~1 chance em 5 de acontecer

export function scenarioPicks(kind: ScenarioKey, games: Fixture[], probs: Map<number, Probs>, rivals: Set<number>, seed: number): Picks {
  const out: Picks = {};
  if (kind === "simular") return out;
  const rand = rng(seed);
  for (const f of games) {
    const p = probs.get(f.id);
    if (!p) continue;
    const fav = favorite(p);
    const pr = [p.home, p.draw, p.away];
    // "Lógica": só vence quem é favorito claro; sem isso times fortes ganhariam 100% dos jogos
    const logic: Outcome = Math.max(p.home, p.away) >= LOGIC_MIN_WIN ? fav : 1;
    let o: Outcome = logic;
    if (kind === "realista") { out[f.id] = sampleScore(p.matrix, rand); continue; }
    if (kind === "zebras") {
      // achata as probabilidades: o azarão ganha muito mais espaço
      const w = [p.home, p.draw, p.away].map((x) => Math.pow(x, 0.3));
      w[fav] *= 0.55;
      let r = rand() * (w[0] + w[1] + w[2]);
      o = (r -= w[0]) <= 0 ? 0 : (r -= w[1]) <= 0 ? 1 : 2;
    } else if (kind === "empates") {
      if (Math.abs(p.home - p.away) < 0.22) o = 1;
    } else if (kind === "otimista" || kind === "pessimista") {
      const hr = rivals.has(f.home), ar = rivals.has(f.away);
      const plausible = (x: Outcome) => pr[x] >= PLAUSIBLE;
      if (hr && ar) {
        // rival x rival: empate tira pontos dos dois (otimista); no pessimista segue a lógica
        o = kind === "otimista" && plausible(1) ? 1 : logic;
      } else if (hr || ar) {
        // o rival cai (otimista) ou sobe (pessimista) um degrau em relação à lógica:
        // vitória↔empate↔derrota, só se o novo resultado tiver chance real de acontecer
        const ladder: Outcome[] = hr ? [0, 1, 2] : [2, 1, 0]; // do melhor para o pior resultado do rival
        const step = ladder.indexOf(logic) + (kind === "otimista" ? 1 : -1);
        const next = ladder[step];
        if (next != null && plausible(next)) o = next;
      }
    }
    out[f.id] = likelyScore(p.matrix, o);
  }
  return out;
}
