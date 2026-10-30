import { getDb } from "@/lib/data";
import { SERIE_A, ratings, table } from "@/lib/analysis";
import Simulator from "@/components/sim/SimulatorClient";

export const dynamic = "force-dynamic";

export default function Home() {
  const db = getDb();
  const r = ratings(db);
  const tbl = table(db);
  const ids = new Set(db.serieATeams);
  const teams = tbl.map(({ team: { id, name, sigla, escudo } }) => ({ id, name, sigla, escudo }));
  const base = tbl.map(({ id, pts, w, e, d, gp, gc, j }) => ({ id, pts, w, e, d, gp, gc, j }));
  const fixtures = db.fixtures
    .filter((f) => ids.has(f.home.id) && ids.has(f.away.id))
    .map((f) => ({ id: f.id, round: f.round ?? 0, date: f.date, home: f.home.id, away: f.away.id }));
  // Jogos já disputados na temporada (para o critério de confronto direto)
  const played = db.matches
    .filter((m) => m.comp === SERIE_A && new Date(m.date).getFullYear() === db.season && ids.has(m.home.id) && ids.has(m.away.id))
    .map((m) => ({ home: m.home.id, away: m.away.id, hg: m.hg!, ag: m.ag! }));
  // Só as forças dos 20 times vão para o navegador
  const sub = { mu: r.mu, home: r.home, teams: Object.fromEntries([...ids].map((id) => [id, r.teams[id]]).filter(([, v]) => v)) };

  return <Simulator teams={teams} base={base} fixtures={fixtures} played={played} ratings={sub} season={db.season} estimatedRounds={db.estimatedRounds} />;
}
