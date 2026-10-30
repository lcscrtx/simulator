// Lê o cache gerado por scripts/sync.mjs e normaliza num banco em memória.
// Roda só no servidor: a chave da API nunca chega ao navegador.
import fs from "node:fs";
import path from "node:path";
import { CSV_PATH, buildCsvDb } from "./csv.ts";

const CACHE_DIR = path.join(process.cwd(), "data/cache");

export type Team = { id: number; name: string; sigla: string; escudo: string };

export type Match = {
  id: number;
  comp: string; // slug do campeonato
  date: string; // ISO
  home: Team;
  away: Team;
  hg: number | null;
  ag: number | null;
  status: string;
  stadium?: string;
  round?: number;
};

export type PlayerLine = { id: number; name: string; pos: string; starts: number; subs: number; goals: number };

export type TeamDetailStats = {
  games: number;
  posse: number;
  finalizacoes: number;
  noGol: number;
  escanteios: number;
  precisaoPasse: number;
  faltas: number;
  esquema: string | null;
  tecnico: string | null;
  players: PlayerLine[];
};

export type Chave = { nome: string; ida: Match | null; volta: Match | null };
export type Fase = { id: number; nome: string; status: string; tipo: string; idaEVolta: boolean; chaves: Chave[] };

export type Db = {
  mode: "test" | "live" | "csv";
  source: { label: string; lastGame: string | null } | null;
  estimatedRounds: boolean; // rodadas dos jogos restantes inferidas (fonte sem calendário)
  season: number;
  updatedAt: number | null;
  teams: Map<number, Team>;
  matches: Match[]; // finalizadas, todas as competições
  fixtures: Match[]; // Série A, ainda não jogadas
  serieATeams: number[];
  officialTable: { id: number; pts: number; w: number; e: number; d: number; gp: number; gc: number; j: number }[] | null;
  details: Map<number, unknown>;
  teamStats: Map<number, TeamDetailStats>;
  cups: { slug: string; nome: string; fases: Fase[]; grupos: Record<string, GroupRow[]> | null }[];
};

export type GroupRow = { pos: number; team: Team; pts: number; j: number; sg: number };

/* eslint-disable @typescript-eslint/no-explicit-any */
const read = (p: string): any => {
  const file = path.join(CACHE_DIR, p.replace(/^\//, "").replaceAll("/", "__") + ".json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
};

const COMP_SLUG: Record<number, string> = {
  10: "campeonato-brasileiro",
  14: "campeonato-brasileiro-serie-b",
  2: "copa-do-brasil",
  7: "copa-libertadores-da-america",
};

const iso = (s: string | null | undefined) => (s ? s.replace(/([+-]\d\d)(\d\d)$/, "$1:$2") : "");

function toTeam(t: any): Team {
  return { id: t.time_id, name: t.nome_popular, sigla: t.sigla, escudo: t.escudo };
}

function toMatch(m: any, round?: number): Match {
  return {
    id: m.partida_id,
    comp: m.campeonato?.slug ?? "",
    date: iso(m.data_realizacao_iso),
    home: toTeam(m.time_mandante),
    away: toTeam(m.time_visitante),
    hg: m.placar_mandante,
    ag: m.placar_visitante,
    status: m.status,
    stadium: m.estadio?.nome_popular,
    round,
  };
}

const pct = (s: unknown) => (typeof s === "string" ? parseFloat(s) : typeof s === "number" ? s : 0);

function buildTeamStats(details: any[]): Map<number, TeamDetailStats> {
  const acc = new Map<number, TeamDetailStats & { _players: Map<number, PlayerLine> }>();
  for (const d of details) {
    for (const side of ["mandante", "visitante"] as const) {
      const team = d[side === "mandante" ? "time_mandante" : "time_visitante"];
      const st = d.estatisticas?.[side];
      const esc = d.escalacoes?.[side];
      if (!team || !esc) continue;
      let a = acc.get(team.time_id);
      if (!a) {
        a = { games: 0, posse: 0, finalizacoes: 0, noGol: 0, escanteios: 0, precisaoPasse: 0, faltas: 0, esquema: null, tecnico: null, players: [], _players: new Map() };
        acc.set(team.time_id, a);
      }
      a.games++;
      a.posse += pct(st?.posse_de_bola);
      a.finalizacoes += st?.finalizacao?.total ?? 0;
      a.noGol += st?.finalizacao?.no_gol ?? 0;
      a.escanteios += st?.escanteios ?? 0;
      a.precisaoPasse += pct(st?.passes?.precisao);
      a.faltas += st?.faltas ?? 0;
      a.esquema ??= esc.esquema_tatico ?? null;
      a.tecnico ??= esc.tecnico?.nome_popular ?? null;
      const touch = (atleta: any, pos: any) => {
        if (!atleta) return null;
        let p = a!._players.get(atleta.atleta_id);
        if (!p) {
          p = { id: atleta.atleta_id, name: atleta.nome_popular, pos: pos?.sigla ?? "", starts: 0, subs: 0, goals: 0 };
          a!._players.set(atleta.atleta_id, p);
        }
        if (!p.pos && pos?.sigla) p.pos = pos.sigla;
        return p;
      };
      for (const t of esc.titulares ?? []) touch(t.atleta, t.posicao)!.starts++;
      for (const s of d.substituicoes?.[side] ?? []) {
        const p = touch(s.entrou, null);
        if (p) p.subs++;
      }
      for (const g of d.gols?.[side] ?? []) {
        if (g.gol_contra) continue;
        const p = touch(g.atleta, null);
        if (p) p.goals++;
      }
    }
  }
  const out = new Map<number, TeamDetailStats>();
  for (const [id, a] of acc) {
    const n = a.games;
    out.set(id, {
      games: n,
      posse: a.posse / n,
      finalizacoes: a.finalizacoes / n,
      noGol: a.noGol / n,
      escanteios: a.escanteios / n,
      precisaoPasse: a.precisaoPasse / n,
      faltas: a.faltas / n,
      esquema: a.esquema,
      tecnico: a.tecnico,
      players: [...a._players.values()].sort((x, y) => y.starts - x.starts || y.goals - x.goals),
    });
  }
  return out;
}

function buildCup(id: number) {
  const camp = read(`/campeonatos/${id}`);
  if (!camp) return null;
  const fasesList: any[] = read(`/campeonatos/${id}/fases`) ?? [];
  const fases: Fase[] = [];
  for (const f of fasesList) {
    const det = read(`/campeonatos/${id}/fases/${f.fase_id}`);
    if (!det) continue;
    const valid = (m: any) => (m?.time_mandante ? toMatch(m) : null);
    fases.push({
      id: f.fase_id,
      nome: f.nome,
      status: f.status,
      tipo: f.tipo,
      idaEVolta: f.ida_e_volta,
      chaves: (det.chaves ?? []).map((c: any) => ({ nome: c.nome, ida: valid(c.partida_ida), volta: valid(c.partida_volta) })),
    });
  }
  const tabela = read(`/campeonatos/${id}/tabela`);
  let grupos: Record<string, GroupRow[]> | null = null;
  if (tabela && !Array.isArray(tabela)) {
    grupos = {};
    for (const fase of Object.values<any>(tabela)) {
      for (const [g, rows] of Object.entries<any>(fase)) {
        grupos[g] = rows.map((r: any) => ({ pos: r.posicao, team: toTeam(r.time), pts: r.pontos, j: r.jogos, sg: r.saldo_gols }));
      }
    }
  }
  return { slug: COMP_SLUG[id], nome: camp.nome_popular ?? camp.nome, fases, grupos };
}

let cachedApi: { at: number; db: Db } | null = null;

function buildApiDb(): Db {
  const metaFile = path.join(CACHE_DIR, "_meta.json");
  const mtime = fs.existsSync(metaFile) ? fs.statSync(metaFile).mtimeMs : 0;
  if (cachedApi && cachedApi.at === mtime) return cachedApi.db;

  const teams = new Map<number, Team>();
  const byId = new Map<number, Match>();
  const add = (m: Match) => {
    teams.set(m.home.id, m.home);
    teams.set(m.away.id, m.away);
    byId.set(m.id, { ...byId.get(m.id), ...m });
  };

  // Rodadas da Série A: jogos futuros (e resultados recentes)
  const rodadas: any[] = read(`/campeonatos/10/rodadas`) ?? [];
  for (const r of rodadas) {
    const det = read(`/campeonatos/10/rodadas/${r.rodada}`);
    for (const m of det?.partidas ?? []) add(toMatch(m, r.rodada));
  }
  const fixtures = [...byId.values()].filter((m) => m.status !== "finalizado");
  const season = Math.max(...fixtures.map((m) => new Date(m.date).getFullYear()).filter(Boolean), new Date().getFullYear() - 1);
  const serieATeams = [...new Set(fixtures.flatMap((m) => [m.home.id, m.away.id]))];

  // Histórico de cada time (todas as competições)
  for (const file of fs.readdirSync(CACHE_DIR)) {
    if (!/^times__\d+__partidas__anteriores\.json$/.test(file)) continue;
    const h = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), "utf8"));
    for (const list of Object.values<any[]>(h ?? {})) for (const m of list) if (!byId.has(m.partida_id) || m.status === "finalizado") add(toMatch(m, byId.get(m.partida_id)?.round));
  }

  const details = new Map<number, unknown>();
  for (const file of fs.readdirSync(CACHE_DIR)) {
    const id = file.match(/^partidas__(\d+)\.json$/)?.[1];
    if (!id) continue;
    const d = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), "utf8"));
    details.set(d.partida_id ?? Number(id), d); // chave pelo conteúdo: evita contar o mesmo jogo duas vezes
  }

  const matches = [...byId.values()]
    .filter((m) => m.status === "finalizado" && m.hg != null && m.ag != null && m.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : null;
  const me = read("/me");
  const db: Db = {
    mode: me?.plano?.tipo === "Sandbox" ? "test" : "live",
    source: null,
    estimatedRounds: false,
    season,
    updatedAt: meta ? Math.max(0, ...Object.values<number>(meta.fetched)) : null,
    teams,
    matches,
    fixtures: fixtures.sort((a, b) => a.date.localeCompare(b.date)),
    serieATeams,
    officialTable: Array.isArray(read(`/campeonatos/10/tabela`))
      ? read(`/campeonatos/10/tabela`).map((r: any) => ({ id: r.time.time_id, pts: r.pontos, w: r.vitorias, e: r.empates, d: r.derrotas, gp: r.gols_pro, gc: r.gols_contra, j: r.jogos }))
      : null,
    details,
    teamStats: buildTeamStats([...details.values()]),
    cups: [2, 7].map(buildCup).filter((c): c is NonNullable<typeof c> => c != null),
  };
  cachedApi = { at: mtime, db };
  return db;
}

let cachedCsv: { at: number; db: Db } | null = null;

/** Fonte de dados: API com chave live > CSV real (football-data) > API sandbox (fictícia). DATA_SOURCE=api|csv força uma delas. */
export function getDb(): Db {
  const api = buildApiDb();
  const forced = process.env.DATA_SOURCE;
  const csvFile = path.join(process.cwd(), CSV_PATH);
  const useCsv = forced === "csv" || (forced !== "api" && api.mode === "test" && fs.existsSync(csvFile));
  if (!useCsv || !fs.existsSync(csvFile)) return api;
  const at = fs.statSync(csvFile).mtimeMs + (cachedApi?.at ?? 0);
  if (cachedCsv && cachedCsv.at === at) return cachedCsv.db;
  cachedCsv = { at, db: buildCsvDb(fs.readFileSync(csvFile, "utf8"), api, fs.statSync(csvFile).mtimeMs) };
  return cachedCsv.db;
}

export function findMatch(db: Db, id: number): Match | undefined {
  return db.fixtures.find((m) => m.id === id) ?? db.matches.find((m) => m.id === id);
}
