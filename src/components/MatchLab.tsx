"use client";

import { useMemo, useState } from "react";
import type { PlayerLine } from "@/lib/data";
import { absenceAdj, expectedGoals, matchProbs, type Rating } from "@/lib/model";
import { ProbBar, pct } from "./ui";

type Side = { id: number; name: string; sigla: string; rating: Rating; players: PlayerLine[]; games: number };

const POS_ORDER = ["GOL", "Z", "L", "V", "M", "A", "P", "C"];
const posRank = (p: string) => {
  const i = POS_ORDER.findIndex((x) => p.toUpperCase().startsWith(x));
  return i < 0 ? 99 : i;
};

function useSide(side: Side) {
  const [out, setOut] = useState<Set<number>>(new Set());
  const [form, setForm] = useState(0);
  const teamGoals = side.players.reduce((s, p) => s + p.goals, 0);
  const adj = useMemo(() => {
    const a = absenceAdj(side.players.filter((p) => out.has(p.id)), side.games, teamGoals);
    return { att: a.att * (1 + form / 100), def: a.def * (1 - form / 200) };
  }, [out, form, side, teamGoals]);
  const toggle = (id: number) =>
    setOut((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return { out, toggle, form, setForm, adj, reset: () => (setOut(new Set()), setForm(0)) };
}

export default function MatchLab({ home, away, mu, homeAdv }: { home: Side; away: Side; mu: number; homeAdv: number }) {
  const [neutral, setNeutral] = useState(false);
  const h = useSide(home);
  const a = useSide(away);
  const r = useMemo(() => ({ mu, home: homeAdv, teams: { [home.id]: home.rating, [away.id]: away.rating } }), [mu, homeAdv, home, away]);
  const base = useMemo(() => matchProbs(...expectedGoals(r, home.id, away.id)), [r, home.id, away.id]);
  const sim = useMemo(
    () => matchProbs(...expectedGoals(r, home.id, away.id, { neutral, adjHome: h.adj, adjAway: a.adj })),
    [r, home.id, away.id, neutral, h.adj, a.adj],
  );
  const changed = neutral || h.out.size > 0 || a.out.size > 0 || h.form !== 0 || a.form !== 0;
  const delta = (x: number, y: number) => {
    const d = Math.round((x - y) * 100);
    return d === 0 ? null : <span className={d > 0 ? "text-home" : "text-away"}>{d > 0 ? `+${d}` : d}</span>;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <div className="card p-4 space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Probabilidades {changed && <span className="text-xs text-accent">(cenário “e se”)</span>}</h2>
          {changed && (
            <button className="text-xs underline text-muted" onClick={() => (h.reset(), a.reset(), setNeutral(false))}>
              voltar ao base
            </button>
          )}
        </div>
        <ProbBar home={sim.home} draw={sim.draw} away={sim.away} labels={[home.sigla, away.sigla]} />
        {changed && (
          <p className="text-xs text-muted tnum">
            Variação vs. base (p.p.): {home.sigla} {delta(sim.home, base.home) ?? "0"} · Empate {delta(sim.draw, base.draw) ?? "0"} ·{" "}
            {away.sigla} {delta(sim.away, base.away) ?? "0"}
          </p>
        )}
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label={`xG ${home.sigla}`} value={sim.xg[0].toFixed(2)} />
          <Stat label="Mais provável" value={`${sim.top[0].h}x${sim.top[0].a}`} sub={pct(sim.top[0].p)} />
          <Stat label={`xG ${away.sigla}`} value={sim.xg[1].toFixed(2)} />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <Stat label="Ambos marcam" value={pct(bothScore(sim.matrix))} />
          <Stat label="Mais de 2,5 gols" value={pct(over(sim.matrix, 2.5))} />
          <Stat label="Menos de 1,5 gols" value={pct(1 - over(sim.matrix, 1.5))} />
        </div>
        <ScoreGrid matrix={sim.matrix} home={home.sigla} away={away.sigla} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={neutral} onChange={(e) => setNeutral(e.target.checked)} />
          Campo neutro (sem vantagem de mando)
        </label>
      </div>

      <div className="card p-4 space-y-4">
        <div>
          <h2 className="font-semibold">E se…?</h2>
          <p className="text-xs text-muted">
            Desmarque jogadores para simular desfalques e ajuste o momento de cada time. O peso de cada jogador vem da frequência como
            titular e da participação nos gols nos jogos analisados (heurística).
          </p>
        </div>
        <SideControls side={home} ctl={h} />
        <SideControls side={away} ctl={a} />
      </div>
    </div>
  );
}

function SideControls({ side, ctl }: { side: Side; ctl: ReturnType<typeof useSide> }) {
  const players = [...side.players].slice(0, 18).sort((x, y) => posRank(x.pos) - posRank(y.pos) || y.starts - x.starts);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{side.name}</span>
        <span className="text-xs text-muted">{side.games} jogo(s) analisado(s)</span>
      </div>
      <label className="flex items-center gap-2 text-xs">
        Momento
        <input type="range" min={-20} max={20} value={ctl.form} onChange={(e) => ctl.setForm(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
        <span className="tnum w-10 text-right">{ctl.form > 0 ? `+${ctl.form}` : ctl.form}%</span>
      </label>
      {players.length === 0 ? (
        <p className="text-xs text-muted">Sem escalações em cache para este time. Rode o sync para buscar detalhes de partidas.</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {players.map((p) => {
            const off = ctl.out.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => ctl.toggle(p.id)}
                title={`${p.starts} jogo(s) como titular · ${p.goals} gol(s)`}
                className={`text-xs rounded-md border px-1.5 py-0.5 ${off ? "line-through opacity-50 border-away" : "border-line hover:border-accent"}`}
              >
                <span className="text-muted mr-1">{p.pos || "?"}</span>
                {p.name}
                {p.goals > 0 && <span className="ml-1">⚽{p.goals > 1 ? p.goals : ""}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-bg p-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="text-lg font-semibold tnum">{value}</div>
      {sub && <div className="text-[11px] text-muted tnum">{sub}</div>}
    </div>
  );
}

function bothScore(m: number[][]) {
  let p = 0;
  m.forEach((row, h) => row.forEach((x, a) => h > 0 && a > 0 && (p += x)));
  return p;
}

function over(m: number[][], line: number) {
  let p = 0;
  m.forEach((row, h) => row.forEach((x, a) => h + a > line && (p += x)));
  return p;
}

function ScoreGrid({ matrix, home, away }: { matrix: number[][]; home: string; away: string }) {
  const N = 6;
  const max = Math.max(...matrix.slice(0, N).flatMap((r) => r.slice(0, N)));
  return (
    <div>
      <div className="text-xs text-muted mb-1">
        Probabilidade de cada placar (linhas: gols {home}; colunas: gols {away})
      </div>
      <div className="grid gap-0.5 text-[11px] tnum" style={{ gridTemplateColumns: `1.5rem repeat(${N}, minmax(0,1fr))` }}>
        <span />
        {Array.from({ length: N }, (_, a) => (
          <span key={a} className="text-center text-muted">{a}</span>
        ))}
        {Array.from({ length: N }, (_, h) => (
          <Row key={h} h={h} N={N} matrix={matrix} max={max} />
        ))}
      </div>
    </div>
  );
}

function Row({ h, N, matrix, max }: { h: number; N: number; matrix: number[][]; max: number }) {
  return (
    <>
      <span className="text-muted grid place-items-center">{h}</span>
      {Array.from({ length: N }, (_, a) => {
        const p = matrix[h][a];
        const color = h > a ? "--home" : h < a ? "--away" : "--draw";
        return (
          <span
            key={a}
            className="rounded py-1 text-center"
            style={{ background: `color-mix(in oklab, var(${color}) ${Math.round((p / max) * 75)}%, transparent)` }}
          >
            {(p * 100).toFixed(1)}
          </span>
        );
      })}
    </>
  );
}
