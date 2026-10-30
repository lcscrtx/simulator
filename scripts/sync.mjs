// Sincroniza a API Futebol para data/cache respeitando o limite diário do plano.
// Uso: node --env-file=.env.local scripts/sync.mjs
// O site nunca chama a API: ele lê apenas os arquivos gerados aqui.
import fs from "node:fs";
import path from "node:path";

const BASE = "https://api.api-futebol.com.br/v1";
const KEY = process.env.API_FUTEBOL_KEY;
const BUDGET = Number(process.env.API_FUTEBOL_DAILY_BUDGET ?? 90);
const IS_TEST = KEY?.startsWith("test_");
const CACHE_DIR = path.resolve("data/cache");
const META_FILE = path.join(CACHE_DIR, "_meta.json");

if (!KEY) {
  console.error("Defina API_FUTEBOL_KEY em .env.local");
  process.exit(1);
}

const CAMP = { serieA: 10, serieB: 14, copaDoBrasil: 2, libertadores: 7 };
const HOUR = 3600_000;

fs.mkdirSync(CACHE_DIR, { recursive: true });
const meta = fs.existsSync(META_FILE)
  ? JSON.parse(fs.readFileSync(META_FILE, "utf8"))
  : { fetched: {}, usage: {} };
const today = new Date(Date.now() - 3 * HOUR).toISOString().slice(0, 10); // reset à meia-noite UTC-3
meta.usage[today] ??= 0;

const fileFor = (p) => path.join(CACHE_DIR, p.replace(/^\//, "").replaceAll("/", "__") + ".json");
const saveMeta = () => fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 1));

class BudgetExceeded extends Error {}

/** GET com cache em disco. ttlHours = Infinity para dados que não mudam mais. */
async function get(p, ttlHours) {
  const file = fileFor(p);
  const fetchedAt = meta.fetched[p];
  if (fs.existsSync(file) && fetchedAt && Date.now() - fetchedAt < ttlHours * HOUR) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }
  // chaves test_ não consomem o plano
  if (!IS_TEST && meta.usage[today] >= BUDGET) throw new BudgetExceeded(p);

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(BASE + p, { headers: { Authorization: `Bearer ${KEY}` } });
    if (!IS_TEST) meta.usage[today]++;
    if (res.ok) {
      const body = await res.json();
      fs.writeFileSync(file, JSON.stringify(body));
      meta.fetched[p] = Date.now();
      saveMeta();
      return body;
    }
    if (res.status === 403 || res.status === 404) {
      console.warn(`  ${res.status} ${p} (fora do plano ou inexistente)`);
      meta.fetched[p] = Date.now();
      saveMeta();
      return null;
    }
    if (res.status === 429) throw new BudgetExceeded(p);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error(`Falha ao buscar ${p}`);
}

const finished = (m) => m?.status === "finalizado";

async function syncLeague(id) {
  const camp = await get(`/campeonatos/${id}`, 24);
  if (!camp) return [];
  const rodadas = (await get(`/campeonatos/${id}/rodadas`, 12)) ?? [];
  const atual = camp.rodada_atual?.rodada ?? 1;

  // Rodadas futuras dão os jogos a simular; a próxima e a recém-encerrada mudam mais.
  const teamIds = new Set();
  const ordered = [...rodadas].sort(
    (a, b) => Math.abs(a.rodada - atual) - Math.abs(b.rodada - atual),
  );
  for (const r of ordered) {
    const near = Math.abs(r.rodada - atual) <= 1;
    const ttl = r.status === "encerrada" && !near ? Infinity : near ? 6 : 72;
    // Rodadas encerradas antigas só são buscadas se já estavam no cache (histórico dos times cobre os placares)
    if (r.status === "encerrada" && !near && !fs.existsSync(fileFor(`/campeonatos/${id}/rodadas/${r.rodada}`))) continue;
    const det = await get(`/campeonatos/${id}/rodadas/${r.rodada}`, ttl);
    for (const m of det?.partidas ?? []) {
      teamIds.add(m.time_mandante.time_id);
      teamIds.add(m.time_visitante.time_id);
    }
  }
  return [...teamIds];
}

async function syncCup(id) {
  const camp = await get(`/campeonatos/${id}`, 24);
  if (!camp) return [];
  const fases = (await get(`/campeonatos/${id}/fases`, 24)) ?? [];
  const teamIds = new Set();
  // Fase atual + fases abertas + as duas últimas finalizadas (para exibir o chaveamento)
  const done = fases.filter((f) => f.status === "finalizado").slice(-2);
  const open = fases.filter((f) => f.status !== "finalizado");
  for (const f of [...open, ...done]) {
    const det = await get(`/campeonatos/${id}/fases/${f.fase_id}`, f.status === "finalizado" ? Infinity : 12);
    for (const c of det?.chaves ?? []) {
      for (const m of [c.partida_ida, c.partida_volta]) {
        if (!m?.time_mandante) continue;
        teamIds.add(m.time_mandante.time_id);
        teamIds.add(m.time_visitante.time_id);
      }
    }
  }
  if (camp.tipo !== "Mata-Mata") await get(`/campeonatos/${id}/tabela`, 12);
  return [...teamIds];
}

async function main() {
  console.log(`Sync (${IS_TEST ? "TESTE: dados fictícios" : "LIVE"}) — uso hoje: ${meta.usage[today]}/${BUDGET}`);
  try {
    const me = await get("/me", 24);
    // Só sincroniza o que o plano libera; Série B fora do plano cai no fallback (scripts/sync-serie-b.mjs).
    const allowed = new Set((me?.campeonatos ?? []).map((c) => c.campeonato_id));
    const serieA = await syncLeague(CAMP.serieA);
    await get(`/campeonatos/${CAMP.serieA}/tabela`, 6);
    const serieB = allowed.has(CAMP.serieB) ? await syncLeague(CAMP.serieB) : [];
    if (serieB.length) await get(`/campeonatos/${CAMP.serieB}/tabela`, 6);
    const cups = [];
    for (const id of [CAMP.copaDoBrasil, CAMP.libertadores]) if (allowed.has(id)) cups.push(...(await syncCup(id)));

    // Histórico completo de cada time (1 req por time) alimenta o modelo.
    for (const t of [...serieA, ...serieB]) await get(`/times/${t}/partidas/anteriores`, 7 * 24);

    // Detalhes de partida (escalações, estatísticas): últimos jogos de cada time, nunca re-buscados.
    const perTeam = Number(process.env.SYNC_DETAILS_PER_TEAM ?? 3);
    const wanted = new Set();
    for (const t of serieA) {
      const hist = JSON.parse(fs.readFileSync(fileFor(`/times/${t}/partidas/anteriores`), "utf8"));
      const all = Object.values(hist ?? {}).flat().filter(finished);
      all.sort((a, b) => (b.data_realizacao_iso ?? "").localeCompare(a.data_realizacao_iso ?? ""));
      all.slice(0, perTeam).forEach((m) => wanted.add(m.partida_id));
    }
    for (const id of wanted) await get(`/partidas/${id}`, Infinity);
    console.log(`Times de copas sem histórico: ${cups.filter((t) => !serieA.includes(t)).length}`);
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
    console.warn(`Limite diário atingido em ${e.message}. O restante será buscado no próximo sync.`);
  }
  saveMeta();
  console.log(`Fim. Uso hoje: ${meta.usage[today]}/${BUDGET}`);
}

main();
