import Link from "next/link";
import type { Chave, Db } from "@/lib/data";
import { ratings } from "@/lib/analysis";
import { simulateTie } from "@/lib/model";
import { Crest, MatchLine, SectionTitle, pct } from "./ui";

export default function CupView({ db, slug, faseParam, base }: { db: Db; slug: string; faseParam?: string; base: string }) {
  const cup = db.cups.find((c) => c.slug === slug);
  if (!cup) return <p className="text-muted">Campeonato fora do plano ou ainda não sincronizado.</p>;
  const withKeys = cup.fases.filter((f) => f.chaves.length > 0);
  const fase =
    cup.fases.find((f) => String(f.id) === faseParam) ??
    withKeys.find((f) => f.status !== "finalizado") ??
    withKeys.at(-1) ??
    cup.fases.at(-1);
  const r = ratings(db);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">{cup.nome}</h1>
      <div className="flex flex-wrap gap-1">
        {cup.fases.map((f) => (
          <Link
            key={f.id}
            href={`${base}?fase=${f.id}`}
            className={`text-sm rounded-md border px-2 py-1 ${f.id === fase?.id ? "bg-accent text-white border-accent" : "border-line bg-card hover:border-accent"}`}
          >
            {f.nome}
          </Link>
        ))}
      </div>

      {fase && fase.chaves.length > 0 && (
        <section>
          <SectionTitle sub={fase.idaEVolta ? "Ida e volta; empate no agregado vai para os pênaltis (50/50 no modelo)." : "Jogo único."}>
            {fase.nome}
          </SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {fase.chaves.map((c) => (
              <ChaveCard key={c.nome} c={c} twoLegs={fase.idaEVolta} r={r} />
            ))}
          </div>
        </section>
      )}

      {fase && fase.chaves.length === 0 && fase.tipo !== "grupos" && (
        <p className="text-sm text-muted">Chaveamento desta fase não está em cache (o sync guarda só as fases recentes para poupar requisições).</p>
      )}

      {cup.grupos && (fase?.tipo === "grupos" || !fase?.chaves.length) && (
        <section>
          <SectionTitle>Fase de grupos</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(cup.grupos).map(([g, rows]) => (
              <div key={g} className="card p-3">
                <div className="text-sm font-semibold mb-2">{g.replace("grupo-", "Grupo ").toUpperCase()}</div>
                <table className="w-full text-xs tnum">
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.team.id} className={row.pos <= 2 ? "font-medium" : "text-muted"}>
                        <td className="py-0.5 w-4">{row.pos}</td>
                        <td className="py-0.5"><span className="flex items-center gap-1"><Crest team={row.team} size={14} />{row.team.name}</span></td>
                        <td className="py-0.5 text-right">{row.pts}</td>
                        <td className="py-0.5 text-right w-8">{row.sg > 0 ? `+${row.sg}` : row.sg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ChaveCard({ c, twoLegs, r }: { c: Chave; twoLegs: boolean; r: ReturnType<typeof ratings> }) {
  const first = c.ida ?? c.volta;
  if (!first) return null;
  const A = first.home, B = first.away;
  const done = (m: Chave["ida"]) => m?.status === "finalizado" && m.hg != null;
  const finished = twoLegs ? done(c.ida) && done(c.volta) : done(c.ida);
  let agg: [number, number] | null = null;
  if (done(c.ida)) agg = [c.ida!.hg!, c.ida!.ag!];
  if (agg && twoLegs && done(c.volta)) agg = [agg[0] + c.volta!.ag!, agg[1] + c.volta!.hg!];
  const sim = finished ? null : simulateTie(r, A.id, B.id, { twoLegs, firstLeg: done(c.ida) ? [c.ida!.hg!, c.ida!.ag!] : undefined, sims: 5000 });

  return (
    <div className="card p-3 space-y-2">
      <div className="flex justify-between text-xs text-muted">
        <span>{c.nome}</span>
        {agg && <span className="tnum">Agregado {A.sigla} {agg[0]} x {agg[1]} {B.sigla}</span>}
      </div>
      {c.ida && <MatchLine m={c.ida} />}
      {c.volta && <MatchLine m={c.volta} />}
      {sim ? (
        <div className="text-xs tnum flex justify-between">
          <span className="text-home font-medium">{A.sigla} avança {pct(sim.a)}</span>
          <span className="text-muted">pênaltis {pct(sim.penalties)}</span>
          <span className="text-away font-medium">{pct(sim.b)} {B.sigla}</span>
        </div>
      ) : (
        <div className="text-xs text-muted">Confronto encerrado.</div>
      )}
      <Link href={`/confronto?a=${A.id}&b=${B.id}&modo=${twoLegs ? "ida-volta" : "unico"}`} className="text-xs underline text-muted">
        Simular com “e se”
      </Link>
    </div>
  );
}
