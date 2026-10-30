import Link from "next/link";
import { notFound } from "next/navigation";
import { findMatch, getDb, type Match, type TeamDetailStats } from "@/lib/data";
import { analyzeMatch, ratings } from "@/lib/analysis";
import { getRating } from "@/lib/model";
import MatchLab from "@/components/MatchLab";
import { Crest, FormBadges, MatchLine, SectionTitle, fmtDate, fmtDay, pct } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Partida(props: PageProps<"/partida/[id]">) {
  const { id } = await props.params;
  const db = getDb();
  const m = findMatch(db, Number(id));
  if (!m) notFound();
  const an = analyzeMatch(db, m);
  const r = ratings(db);
  const side = (t: Match["home"], stats: TeamDetailStats | null) => ({
    id: t.id,
    name: t.name,
    sigla: t.sigla,
    rating: getRating(r, t.id),
    players: stats?.players ?? [],
    games: stats?.games ?? 0,
  });
  const played = m.status === "finalizado";

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="text-xs text-muted text-center">
          {m.round ? `${m.round}ª rodada · ` : ""}
          {fmtDate(m.date)}{m.stadium ? ` · ${m.stadium}` : ""}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <TeamHead team={m.home} pos={an.position.home} />
          <div className="text-3xl font-bold tnum">{played ? `${m.hg} x ${m.ag}` : "vs"}</div>
          <TeamHead team={m.away} pos={an.position.away} />
        </div>
        {played && <p className="mt-2 text-center text-xs text-muted">Partida encerrada. As probabilidades abaixo usam o modelo atual.</p>}
      </div>

      <MatchLab home={side(m.home, an.stats.home)} away={side(m.away, an.stats.away)} mu={an.ratings.mu} homeAdv={an.ratings.homeAdv} />

      {an.factors.length > 0 && (
        <section className="card p-4">
          <SectionTitle>Fatores-chave</SectionTitle>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {an.factors.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        {([["home", m.home], ["away", m.away]] as const).map(([k, t]) => {
          const f = an[k];
          const rt = getRating(r, t.id);
          return (
            <div key={k} className="card p-4 space-y-3">
              <div className="flex items-center gap-2 font-semibold">
                <Crest team={t} /> {t.name}
                <span className="ml-auto"><FormBadges form={f.last.map((x) => x.res).reverse()} /></span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm tnum">
                <KV k="Força de ataque" v={`${Math.round(rt.att * 100)}`} hint="100 = média dos times da Série A" />
                <KV k="Solidez defensiva" v={`${Math.round((1 / rt.def) * 100)}`} hint="100 = média; maior é melhor" />
                <KV k="Gols marcados (últ. 10)" v={f.avgFor.toFixed(1)} />
                <KV k="Gols sofridos (últ. 10)" v={f.avgAgainst.toFixed(1)} />
                <KV k="Sem sofrer gol" v={pct(f.cleanSheets)} />
                <KV k={k === "home" ? "Em casa no BR" : "Fora no BR"} v={`${f.venue.v}V ${f.venue.e}E ${f.venue.d}D`} />
              </div>
              <div>
                <div className="text-xs text-muted mb-1">Últimos jogos</div>
                <ul className="space-y-1">
                  {f.last.map(({ match }) => (
                    <li key={match.id} className="flex items-center gap-2 text-xs">
                      <span className="text-muted w-14 shrink-0">{fmtDay(match.date)}</span>
                      <span className="flex-1"><MatchLine m={match} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </section>

      {(an.stats.home || an.stats.away) && (
        <section className="card p-4">
          <SectionTitle sub="Médias dos jogos com estatísticas detalhadas em cache.">Estatísticas médias</SectionTitle>
          <StatsCompare home={an.stats.home} away={an.stats.away} names={[m.home.sigla, m.away.sigla]} />
        </section>
      )}

      <section className="card p-4">
        <SectionTitle sub={an.h2h.length ? `${m.home.name} ${an.h2hSum.home}V · ${an.h2hSum.draw}E · ${an.h2hSum.away}V ${m.away.name}` : undefined}>
          Retrospecto
        </SectionTitle>
        {an.h2h.length === 0 ? (
          <p className="text-sm text-muted">Sem confrontos no histórico disponível.</p>
        ) : (
          <ul className="space-y-1">
            {an.h2h.map((x) => (
              <li key={x.id} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-muted w-16 shrink-0">{fmtDay(x.date)}</span>
                <span className="flex-1"><MatchLine m={x} /></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted">
        <Link href={`/confronto?a=${m.home.id}&b=${m.away.id}`} className="underline">Simular como mata-mata</Link>
      </p>
    </div>
  );
}

function TeamHead({ team, pos }: { team: Match["home"]; pos: number | null }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <Crest team={team} size={56} />
      <div className="font-semibold">{team.name}</div>
      {pos && <div className="text-xs text-muted">{pos}º na tabela</div>}
    </div>
  );
}

function KV({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-bg p-2" title={hint}>
      <div className="text-[11px] text-muted">{k}</div>
      <div className="font-semibold">{v}</div>
    </div>
  );
}

function StatsCompare({ home, away, names }: { home: TeamDetailStats | null; away: TeamDetailStats | null; names: [string, string] }) {
  const rows: [string, (s: TeamDetailStats) => number, string?][] = [
    ["Posse de bola", (s) => s.posse, "%"],
    ["Finalizações", (s) => s.finalizacoes],
    ["No gol", (s) => s.noGol],
    ["Escanteios", (s) => s.escanteios],
    ["Precisão de passe", (s) => s.precisaoPasse, "%"],
    ["Faltas", (s) => s.faltas],
  ];
  return (
    <div className="space-y-2 text-sm tnum">
      <div className="grid grid-cols-[4rem_1fr_4rem] text-xs text-muted">
        <span>{names[0]} ({home?.games ?? 0}j)</span>
        <span className="text-center">{home?.esquema ?? "—"} × {away?.esquema ?? "—"}</span>
        <span className="text-right">{names[1]} ({away?.games ?? 0}j)</span>
      </div>
      {rows.map(([label, get, unit = ""]) => {
        const hv = home ? get(home) : 0, av = away ? get(away) : 0;
        const tot = hv + av || 1;
        return (
          <div key={label}>
            <div className="grid grid-cols-[4rem_1fr_4rem]">
              <span>{home ? hv.toFixed(1) + unit : "—"}</span>
              <span className="text-center text-xs text-muted">{label}</span>
              <span className="text-right">{away ? av.toFixed(1) + unit : "—"}</span>
            </div>
            <div className="flex h-1.5 gap-0.5">
              <div className="bg-home rounded-l" style={{ width: `${(hv / tot) * 100}%` }} />
              <div className="bg-away rounded-r" style={{ width: `${(av / tot) * 100}%` }} />
            </div>
          </div>
        );
      })}
      {(home?.tecnico || away?.tecnico) && (
        <p className="text-xs text-muted">Técnicos: {home?.tecnico ?? "—"} × {away?.tecnico ?? "—"}</p>
      )}
    </div>
  );
}
