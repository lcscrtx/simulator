// Backtest do modelo com resultados reais do Brasileirão (football-data.co.uk, inclui odds de fechamento).
// Cada jogo é previsto só com jogos anteriores a ele (walk-forward, refit semanal) e comparado
// com o resultado real e com o mercado de apostas.
// Uso: node scripts/backtest.ts [--grid]
import fs from "node:fs";
import { expectedGoals, fitRatings, matchProbs, type FitOptions } from "../src/lib/model.ts";

type Row = { season: number; date: string; home: string; away: string; hg: number; ag: number; odds: [number, number, number] | null };

const csv = fs.readFileSync("data/external/BRA.csv", "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
const head = csv[0].split(",");
const col = (n: string) => head.indexOf(n);
const rows: Row[] = csv.slice(1).map((line) => {
  const c = line.split(",");
  const [d, m, y] = c[col("Date")].split("/");
  const o = [c[col("AvgCH")], c[col("AvgCD")], c[col("AvgCA")]].map(Number);
  return {
    season: Number(c[col("Season")]),
    date: `${y}-${m}-${d}T12:00:00-03:00`,
    home: c[col("Home")],
    away: c[col("Away")],
    hg: Number(c[col("HG")]),
    ag: Number(c[col("AG")]),
    odds: o.every((x) => x > 1) ? (o as [number, number, number]) : null,
  };
}).filter((r) => !Number.isNaN(r.hg));
rows.sort((a, b) => a.date.localeCompare(b.date));

const ids = new Map<string, number>();
const id = (name: string) => ids.get(name) ?? (ids.set(name, ids.size + 1), ids.size);
const games = rows.map((r) => ({ ...r, home: { id: id(r.home) }, away: { id: id(r.away) }, name: [r.home, r.away] }));

const TEST_SEASONS = [2024, 2025, 2026];
const WINDOW_DAYS = 4 * 365;
const DAY = 86400000;

type Result = { n: number; logloss: number; brier: number; acc: number; drawPred: number; drawReal: number; market?: { logloss: number; brier: number; acc: number } };

function run(opts: FitOptions & { rho?: number; promotedPrior?: boolean }, withMarket = false, calib?: number[][]): Result {
  let n = 0, ll = 0, br = 0, acc = 0, dp = 0, dr = 0, mll = 0, mbr = 0, macc = 0, mn = 0;
  const test = games.filter((g) => TEST_SEASONS.includes(g.season));
  // agrupa por semana para refazer o ajuste uma vez por semana
  const weeks = new Map<number, typeof test>();
  for (const g of test) {
    const wk = Math.floor(new Date(g.date).getTime() / (7 * DAY));
    weeks.set(wk, [...(weeks.get(wk) ?? []), g]);
  }
  for (const [wk, list] of weeks) {
    const t0 = wk * 7 * DAY;
    const train = games.filter((g) => { const t = new Date(g.date).getTime(); return t < t0 && t > t0 - WINDOW_DAYS * DAY; });
    // times da temporada: com promotedPrior, quem não jogou a Série A no último ano começa com prior de "fraco"
    const season = list[0].season;
    const seasonTeams = [...new Set(games.filter((g) => g.season === season).flatMap((g) => [g.home.id, g.away.id]))];
    const lastYear = new Set(train.filter((g) => new Date(g.date).getTime() > t0 - 365 * DAY).flatMap((g) => [g.home.id, g.away.id]));
    const known = opts.promotedPrior ? seasonTeams.filter((t) => lastYear.has(t)) : seasonTeams;
    const r = fitRatings(train, known, t0, opts);
    for (const g of list) {
      const p = matchProbs(...expectedGoals(r, g.home.id, g.away.id), opts.rho);
      const pr = [p.home, p.draw, p.away];
      const res = g.hg > g.ag ? 0 : g.hg === g.ag ? 1 : 2;
      n++;
      ll -= Math.log(Math.max(1e-9, pr[res]));
      br += pr.reduce((s, x, i) => s + (x - (i === res ? 1 : 0)) ** 2, 0);
      if (pr.indexOf(Math.max(...pr)) === res) acc++;
      dp += p.draw; dr += res === 1 ? 1 : 0;
      if (calib) { const b = Math.min(9, Math.floor(p.home * 10)); calib[b][0] += p.home; calib[b][1] += res === 0 ? 1 : 0; calib[b][2]++; }
      if (withMarket && g.odds) {
        const inv = g.odds.map((o) => 1 / o), s = inv[0] + inv[1] + inv[2];
        const m = inv.map((x) => x / s); // remove a margem da casa
        mn++;
        mll -= Math.log(m[res]);
        mbr += m.reduce((s2, x, i) => s2 + (x - (i === res ? 1 : 0)) ** 2, 0);
        if (m.indexOf(Math.max(...m)) === res) macc++;
      }
    }
  }
  return {
    n, logloss: ll / n, brier: br / n, acc: acc / n, drawPred: dp / n, drawReal: dr / n,
    market: withMarket ? { logloss: mll / mn, brier: mbr / mn, acc: macc / mn } : undefined,
  };
}

const f = (x: number, d = 4) => x.toFixed(d);

if (process.argv.includes("--grid")) {
  const out: { cfg: string; r: Result }[] = [];
  for (const halfLifeDays of [120, 200, 300, 500])
    for (const priorWeight of [2, 4, 8])
      for (const rho of [0, -0.06, -0.12])
        for (const promotedPrior of [false, true]) {
          const r = run({ halfLifeDays, priorWeight, rho, promotedPrior });
          out.push({ cfg: `meia-vida=${halfLifeDays} prior=${priorWeight} rho=${rho} promovidos=${promotedPrior ? "fracos" : "médios"}`, r });
        }
  out.sort((a, b) => a.r.logloss - b.r.logloss);
  console.log("Melhores configurações (log loss, menor é melhor):");
  for (const { cfg, r } of out.slice(0, 8)) console.log(`  ${f(r.logloss)}  brier ${f(r.brier)}  acerto ${f(r.acc * 100, 1)}%  ${cfg}`);
  console.log(`Pior: ${f(out.at(-1)!.r.logloss)} ${out.at(-1)!.cfg}`);
} else {
  const calib = Array.from({ length: 10 }, () => [0, 0, 0]);
  const r = run({ promotedPrior: process.argv.includes("--promoted") }, true, calib);
  const base = (() => { // referência ingênua: frequências históricas de casa/empate/fora
    const tr = games.filter((g) => g.season < 2024);
    const fr = [0, 0, 0];
    for (const g of tr) fr[g.hg > g.ag ? 0 : g.hg === g.ag ? 1 : 2]++;
    const p = fr.map((x) => x / tr.length);
    const te = games.filter((g) => TEST_SEASONS.includes(g.season));
    return te.reduce((s, g) => s - Math.log(p[g.hg > g.ag ? 0 : g.hg === g.ag ? 1 : 2]), 0) / te.length;
  })();
  console.log(`Jogos testados: ${r.n} (temporadas ${TEST_SEASONS.join(", ")})`);
  console.log(`                 log loss  brier   acerto`);
  console.log(`Modelo           ${f(r.logloss)}    ${f(r.brier)}  ${f(r.acc * 100, 1)}%`);
  console.log(`Mercado (odds)   ${f(r.market!.logloss)}    ${f(r.market!.brier)}  ${f(r.market!.acc * 100, 1)}%`);
  console.log(`Só mando de campo ${f(base)}`);
  console.log(`Empates: previsto ${f(r.drawPred * 100, 1)}% · real ${f(r.drawReal * 100, 1)}%`);
  console.log(`Calibração (vitória do mandante):`);
  for (const [i, [sp, hit, cnt]] of calib.entries()) if (cnt >= 20) console.log(`  ${i * 10}-${i * 10 + 10}%: previsto ${f((sp / cnt) * 100, 1)}% · real ${f((hit / cnt) * 100, 1)}% (${cnt} jogos)`);
}
