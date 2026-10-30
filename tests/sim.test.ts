// Testes da lógica do simulador. Uso: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { expectedGoals, matchProbs, type Ratings } from "../src/lib/model.ts";
import {
  findRivals, liveTable, monteCarlo, projectedTable, scenarioPicks,
  type BaseRow, type Fixture, type Picks,
} from "../src/lib/sim.ts";

// Liga sintética: 6 times em turno e returno (10 jogos cada); força decrescente do time 1 ao 6
const N = 6;
const ids = Array.from({ length: N }, (_, i) => i + 1);
const fixtures: Fixture[] = [];
let fid = 1;
for (const h of ids) for (const a of ids) if (h !== a) fixtures.push({ id: fid++, round: 1, date: "", home: h, away: a });
const base: BaseRow[] = ids.map((id) => ({ id, pts: 0, w: 0, e: 0, d: 0, gp: 0, gc: 0, j: 0 }));
const ratings: Ratings = {
  mu: 1.1, home: 1.25,
  teams: Object.fromEntries(ids.map((id) => [id, { att: 1.5 - id * 0.15, def: 0.6 + id * 0.12, n: 30 }])),
};
const probs = new Map(fixtures.map((f) => [f.id, matchProbs(...expectedGoals(ratings, f.home, f.away))]));
const xg = new Map(fixtures.map((f) => [f.id, expectedGoals(ratings, f.home, f.away)]));
const all = (kind: Parameters<typeof scenarioPicks>[0], rivals: number[] = []) => scenarioPicks(kind, fixtures, probs, new Set(rivals), 1);

test("com todos os jogos preenchidos, cada time termina com 2×(n−1) jogos e os pontos fecham", () => {
  for (const kind of ["logica", "realista", "zebras", "empates"] as const) {
    const t = liveTable(base, fixtures, all(kind));
    for (const r of t) assert.equal(r.j, 2 * (N - 1), `${kind}: time ${r.id} com ${r.j} jogos`);
    const draws = t.reduce((s, r) => s + r.e, 0) / 2;
    const games = fixtures.length;
    assert.equal(t.reduce((s, r) => s + r.pts, 0), 3 * (games - draws) + 2 * draws, `${kind}: soma de pontos`);
  }
});

test("confronto direto desempata times iguais em pontos, vitórias, saldo e gols", () => {
  const b: BaseRow[] = [
    { id: 1, pts: 10, w: 3, e: 1, d: 1, gp: 8, gc: 5, j: 5 },
    { id: 2, pts: 10, w: 3, e: 1, d: 1, gp: 8, gc: 5, j: 5 },
  ];
  const t = liveTable(b, [], {}, [{ home: 1, away: 2, hg: 0, ag: 1 }]);
  assert.deepEqual(t.map((r) => r.id), [2, 1]);
});

test("'Tudo na lógica' não dá 100% de vitórias ao favorito em jogo parelho", () => {
  const p = all("logica");
  for (const f of fixtures) {
    const pr = probs.get(f.id)!;
    const pick = p[f.id];
    if (Math.max(pr.home, pr.away) < 0.45) assert.equal(pick.h, pick.a, `jogo ${f.home}x${f.away} parelho deveria empatar`);
  }
});

test("cenário otimista nunca dá mais pontos a um rival que a lógica; pessimista nunca dá menos", () => {
  const rivals = [2, 3];
  const ptsOf = (picks: Picks, id: number) => liveTable(base, fixtures, picks).find((r) => r.id === id)!.pts;
  for (const r of rivals) {
    assert.ok(ptsOf(all("otimista", rivals), r) <= ptsOf(all("logica"), r));
    assert.ok(ptsOf(all("pessimista", rivals), r) >= ptsOf(all("logica"), r));
  }
});

test("cenário otimista é plausível: rival forte não perde jogos em que é amplo favorito", () => {
  const picks = all("otimista", [1]);
  for (const f of fixtures.filter((x) => x.home === 1)) {
    const pr = probs.get(f.id)!, pick = picks[f.id];
    if (pr.away < 0.22) assert.ok(pick.h >= pick.a, `time 1 em casa contra ${f.away} não deveria perder`);
  }
});

test("rivais seguem o objetivo: na luta contra a queda, são os times perto da linha do Z4", () => {
  // 20 times com pontuação final esperada de 80 (1º) a 23 (20º), 3 pontos de diferença entre eles
  const exp = new Map(Array.from({ length: 20 }, (_, i) => [i + 1, 80 - i * 3]));
  const fuga = findRivals(exp, 17, "fuga");
  assert.ok(fuga.every((id) => id >= 14 && id <= 19), `rivais na fuga: ${fuga}`);
  const titulo = findRivals(exp, 17, "titulo");
  assert.ok(titulo.every((id) => id <= 4), `rivais no título: ${titulo}`);
});

test("Monte Carlo: distribuição de posições soma 1 e respeita resultados já definidos", () => {
  const mc = monteCarlo(base, fixtures, {}, xg, 1, 500);
  for (const [, t] of mc.teams) assert.ok(Math.abs(t.posDist.reduce((s, x) => s + x, 0) - 1) < 1e-9);
  const fixed = monteCarlo(base, fixtures, all("logica"), xg, 1, 50);
  const champion = liveTable(base, fixtures, all("logica"))[0].id;
  assert.equal(fixed.teams.get(champion)!.title, 1);
});

test("tabela projetada: preencher só os jogos de um time não o coloca artificialmente na frente", () => {
  // o time 6 (o mais fraco) vence todos os seus jogos; os demais ficam sem palpite
  const picks: Picks = {};
  for (const f of fixtures) if (f.home === 6) picks[f.id] = { h: 1, a: 0 }; else if (f.away === 6) picks[f.id] = { h: 0, a: 1 };
  const { table } = projectedTable(base, fixtures, picks, probs);
  for (const r of table) assert.equal(r.j, 2 * (N - 1), `time ${r.id} com ${r.j} jogos na projeção`);
  // os outros também ganham pontos esperados dos jogos entre si; o 2º não pode ficar com quase nada
  const second = table.find((r) => r.id !== 6)!;
  assert.ok(second.pts >= 10, `2º colocado com só ${second.pts} pts`);
});
