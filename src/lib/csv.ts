// Fonte de dados real e gratuita: resultados do Brasileirão do football-data.co.uk (data/external/BRA.csv).
// Não traz calendário: os jogos restantes são os confrontos (mandante × visitante) que ainda não aconteceram,
// e as rodadas deles são estimadas. Escudos e siglas vêm da API quando o nome do time bate.
import type { Db, Match, Team } from "./data.ts";
import { rng } from "./model.ts";

export const CSV_PATH = "data/external/BRA.csv";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
// "Flamengo RJ", "Botafogo RJ", "Chapecoense-SC": o sufixo de estado não existe no nome da API
const stripState = (s: string) => s.replace(/[\s-][A-Z]{2}$/, "");

const COMP = "campeonato-brasileiro";

export function buildCsvDb(csv: string, api: Db, mtime: number): Db {
  const lines = csv.replace(/^﻿/, "").trim().split(/\r?\n/);
  const head = lines[0].split(",");
  const col = (n: string) => head.indexOf(n);

  // Times da API por nome normalizado (com e sem sufixo de estado)
  const apiByName = new Map<string, Team>();
  for (const t of api.teams.values()) apiByName.set(norm(t.name), t);
  const teams = new Map<number, Team>();
  const byCsvName = new Map<string, Team>();
  let synthetic = 900000;
  const team = (name: string): Team => {
    let t = byCsvName.get(name);
    if (t) return t;
    const found = apiByName.get(norm(name)) ?? apiByName.get(norm(stripState(name)));
    t = found ?? { id: synthetic++, name: stripState(name), sigla: stripState(name).slice(0, 3).toUpperCase(), escudo: "" };
    byCsvName.set(name, t);
    teams.set(t.id, t);
    return t;
  };

  const matches: Match[] = [];
  lines.slice(1).forEach((line, i) => {
    const c = line.split(",");
    if (c[col("League")] !== "Serie A") return;
    const hg = Number(c[col("HG")]), ag = Number(c[col("AG")]);
    if (c[col("HG")] === "" || Number.isNaN(hg)) return;
    const [d, m, y] = c[col("Date")].split("/");
    matches.push({
      id: 1_000_000 + i, // posição no arquivo: estável porque o CSV só cresce no fim
      comp: COMP,
      date: `${y}-${m}-${d}T${c[col("Time")] || "16:00"}:00-03:00`,
      home: team(c[col("Home")]),
      away: team(c[col("Away")]),
      hg, ag,
      status: "finalizado",
    });
  });
  matches.sort((a, b) => a.date.localeCompare(b.date));

  const season = Math.max(...lines.slice(1).map((l) => Number(l.split(",")[col("Season")])).filter(Boolean));
  const current = matches.filter((m) => new Date(m.date).getFullYear() === season);
  const seasonTeams = [...new Set(current.flatMap((m) => [m.home.id, m.away.id]))];

  // Turno e returno: falta cada par ordenado (mandante, visitante) que ainda não jogou
  const playedPairs = new Set(current.map((m) => `${m.home.id}:${m.away.id}`));
  const pending: [number, number][] = [];
  for (const h of seasonTeams) for (const a of seasonTeams) if (h !== a && !playedPairs.has(`${h}:${a}`)) pending.push([h, a]);

  const fixtures = estimateRounds(pending, current, seasonTeams).map(([h, a, round]) => ({
    id: 9_000_000 + h * 10_000 + a, // estável enquanto o confronto não acontece (palpites salvos sobrevivem)
    comp: COMP,
    date: "",
    home: teams.get(h)!,
    away: teams.get(a)!,
    hg: null,
    ag: null,
    status: "agendado",
    round,
  }));

  const last = current.at(-1)?.date ?? null;
  return {
    ...api,
    mode: "csv",
    source: { label: "football-data.co.uk", lastGame: last },
    estimatedRounds: true,
    season,
    // data do arquivo não serve: a Vercel zera os mtimes no deploy
    updatedAt: last ? new Date(last).getTime() : mtime,
    teams,
    matches,
    fixtures,
    serieATeams: seasonTeams,
    officialTable: null,
    // escalações e estatísticas do sandbox são fictícias: não misturar com dados reais
    details: new Map(),
    teamStats: new Map(),
  };
}

/** Distribui os jogos restantes em rodadas sem time repetido, priorizando quem tem mais jogos pendentes. */
function estimateRounds(pending: [number, number][], played: Match[], teams: number[]): [number, number, number][] {
  const count = new Map(teams.map((t) => [t, 0]));
  for (const m of played) { count.set(m.home.id, count.get(m.home.id)! + 1); count.set(m.away.id, count.get(m.away.id)! + 1); }
  const first = Math.min(...count.values()) + 1;
  // mínimo possível de rodadas = maior número de jogos pendentes de um time
  const need = Math.max(...teams.map((t) => pending.filter(([h, a]) => h === t || a === t).length));
  const rand = rng(1);
  let best: [number, number, number][] = [];
  let bestRounds = Infinity;
  // guloso com desempate aleatório; repete até achar uma divisão com o mínimo de rodadas
  for (let attempt = 0; attempt < 300 && bestRounds > need; attempt++) {
    const left = [...pending];
    const remaining = (t: number) => left.filter(([h, a]) => h === t || a === t).length;
    const out: [number, number, number][] = [];
    let round = 0;
    while (left.length) {
      const busy = new Set<number>();
      const noise = new Map(left.map((p) => [p, rand()]));
      left.sort((x, y) => remaining(y[0]) + remaining(y[1]) - (remaining(x[0]) + remaining(x[1])) || noise.get(x)! - noise.get(y)!);
      for (let i = 0; i < left.length; ) {
        const [h, a] = left[i];
        if (busy.has(h) || busy.has(a)) { i++; continue; }
        busy.add(h); busy.add(a);
        out.push([h, a, first + round]);
        left.splice(i, 1);
      }
      round++;
    }
    if (round < bestRounds) { bestRounds = round; best = out; }
  }
  return best;
}
