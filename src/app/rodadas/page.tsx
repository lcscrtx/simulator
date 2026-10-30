import Link from "next/link";
import { getDb } from "@/lib/data";
import { ratings } from "@/lib/analysis";
import { expectedGoals, matchProbs } from "@/lib/model";
import { MatchLine, ProbBar, fmtDate, pct } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Rodadas(props: PageProps<"/rodadas">) {
  const db = getDb();
  const r = ratings(db);
  const rounds = [...new Set(db.fixtures.map((m) => m.round).filter((x): x is number => x != null))].sort((a, b) => a - b);
  const q = Number((await props.searchParams).r);
  const round = rounds.includes(q) ? q : rounds[0];
  const games = db.fixtures.filter((m) => m.round === round);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Rodadas restantes</h1>
        {db.estimatedRounds && <p className="text-sm text-muted">Jogos que faltam; a divisão em rodadas e as datas são estimadas.</p>}
      </div>
      <div className="flex flex-wrap gap-1">
        {rounds.map((n) => (
          <Link
            key={n}
            href={`/rodadas?r=${n}`}
            className={`tnum text-sm w-9 h-8 grid place-items-center rounded-md border ${n === round ? "bg-accent text-white border-accent" : "border-line bg-card hover:border-accent"}`}
          >
            {n}
          </Link>
        ))}
      </div>
      <div className="card divide-y divide-line">
        {games.map((m) => {
          const pr = matchProbs(...expectedGoals(r, m.home.id, m.away.id));
          return (
            <Link key={m.id} href={`/partida/${m.id}`} className="grid gap-2 p-3 md:grid-cols-[1.2fr_1fr_auto] md:items-center hover:bg-bg">
              <div>
                <div className="text-xs text-muted">{fmtDate(m.date)}{m.stadium ? ` · ${m.stadium}` : ""}</div>
                <MatchLine m={m} href={false} />
              </div>
              <ProbBar home={pr.home} draw={pr.draw} away={pr.away} labels={[m.home.sigla, m.away.sigla]} />
              <div className="text-xs text-muted tnum md:text-right">
                xG {pr.xg[0].toFixed(2)} – {pr.xg[1].toFixed(2)}
                <br />
                {pr.top[0].h}x{pr.top[0].a} ({pct(pr.top[0].p)})
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
