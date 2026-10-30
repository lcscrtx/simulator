import Link from "next/link";
import { getDb } from "@/lib/data";
import { projection, ratings, table } from "@/lib/analysis";
import { expectedGoals, matchProbs } from "@/lib/model";
import { Crest, FormBadges, MatchLine, ProbBar, SectionTitle, fmtDate, pct } from "@/components/ui";

export const dynamic = "force-dynamic";

// Intensidade do fundo proporcional à probabilidade
const heat = (p: number, color: string) => ({ background: `color-mix(in oklab, var(${color}) ${Math.round(p * 70)}%, transparent)` });

export default function Projecao() {
  const db = getDb();
  const tbl = table(db);
  const proj = projection(db);
  const byId = new Map(proj.teams.map((t) => [t.id, t]));
  const r = ratings(db);
  const nextRound = db.fixtures[0]?.round;
  const next = db.fixtures.filter((m) => m.round === nextRound);
  const remaining = new Set(db.fixtures.map((m) => m.round)).size;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Brasileirão {db.season}</h1>
        <p className="text-sm text-muted">
          Tabela atual + {proj.sims.toLocaleString("pt-BR")} simulações das {db.fixtures.length} partidas restantes ({remaining} rodadas).
        </p>
      </div>

      <section className="card overflow-x-auto">
        <table className="w-full text-sm tnum">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="p-2 text-left">#</th>
              <th className="p-2 text-left">Time</th>
              <th className="p-2">P</th>
              <th className="p-2">J</th>
              <th className="p-2 hidden sm:table-cell">V</th>
              <th className="p-2 hidden sm:table-cell">E</th>
              <th className="p-2 hidden sm:table-cell">D</th>
              <th className="p-2">SG</th>
              <th className="p-2 hidden md:table-cell">Últimos</th>
              <th className="p-2 border-l border-line" title="Pontos médios ao final">Pts proj.</th>
              <th className="p-2">Título</th>
              <th className="p-2">G4</th>
              <th className="p-2" title="Vaga provável na Libertadores">G6</th>
              <th className="p-2">Z4</th>
            </tr>
          </thead>
          <tbody>
            {tbl.map((t, i) => {
              const p = byId.get(t.id)!;
              return (
                <tr key={t.id} className="border-b border-line last:border-0">
                  <td className="p-2 text-muted">{i + 1}</td>
                  <td className="p-2">
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Crest team={t.team} /> {t.team.name}
                    </span>
                  </td>
                  <td className="p-2 text-center font-semibold">{t.pts}</td>
                  <td className="p-2 text-center">{t.j}</td>
                  <td className="p-2 text-center hidden sm:table-cell">{t.w}</td>
                  <td className="p-2 text-center hidden sm:table-cell">{t.e}</td>
                  <td className="p-2 text-center hidden sm:table-cell">{t.d}</td>
                  <td className="p-2 text-center">{t.gp - t.gc}</td>
                  <td className="p-2 hidden md:table-cell"><FormBadges form={t.form} /></td>
                  <td className="p-2 text-center border-l border-line">{p.avgPts.toFixed(0)}</td>
                  <td className="p-2 text-center" style={heat(p.title, "--home")}>{pct(p.title)}</td>
                  <td className="p-2 text-center" style={heat(p.g4, "--home")}>{pct(p.g4)}</td>
                  <td className="p-2 text-center" style={heat(p.g6, "--home")}>{pct(p.g6)}</td>
                  <td className="p-2 text-center" style={heat(p.z4, "--away")}>{pct(p.z4)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {next.length > 0 && (
        <section>
          <SectionTitle sub="Clique numa partida para ver dados, retrospecto e o modo “e se”.">
            Próxima rodada: {nextRound}ª
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {next.map((m) => {
              const pr = matchProbs(...expectedGoals(r, m.home.id, m.away.id));
              return (
                <Link key={m.id} href={`/partida/${m.id}`} className="card p-3 hover:border-accent block">
                  <div className="text-xs text-muted mb-1">{fmtDate(m.date)}{m.stadium ? ` · ${m.stadium}` : ""}</div>
                  <MatchLine m={m} href={false} />
                  <div className="mt-2">
                    <ProbBar home={pr.home} draw={pr.draw} away={pr.away} labels={[m.home.sigla, m.away.sigla]} />
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    Placar mais provável: {pr.top[0].h}x{pr.top[0].a} ({pct(pr.top[0].p)})
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
