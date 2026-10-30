"use client";

import { useMemo } from "react";
import { GOALS, goalProb, keyGames, type KeyGame, momentoLabel, pointsNeeded, zoneOf, type Fixture, type GoalKey, type LiveRow, type MonteCarlo, type Picks } from "@/lib/sim";
import { pct } from "../ui";
import type { SimTeam } from "./Simulator";

const ZONE_BAR: Record<string, string> = { lib: "#1d4ed8", pre: "#60a5fa", sula: "#16a34a", z4: "#dc2626" };

export default function MyTeamPanel(props: {
  team: SimTeam; teams: Map<number, SimTeam>; table: LiveRow[]; mc: MonteCarlo | null; busy: boolean;
  goal: GoalKey | null; setGoal: (g: GoalKey) => void; momento: number; setMomento: (v: number) => void;
  onChangeTeam: () => void; onApply: (f: Fixture, o: 0 | 1 | 2) => void; fixtures: Fixture[]; picks: Picks; scenarioLabel: string | null; autoGoal: GoalKey; realPts: number;
}) {
  const { team, teams, table, mc, goal, setGoal, momento, setMomento, onChangeTeam, onApply, fixtures, picks, scenarioLabel, autoGoal, realPts } = props;
  const n = table.length;
  const pos = table.findIndex((r) => r.id === team.id) + 1;
  const row = table[pos - 1];
  const odds = mc?.teams.get(team.id);
  const myFixtures = fixtures.filter((f) => f.home === team.id || f.away === team.id);
  const left = myFixtures.filter((f) => !picks[f.id]).length;
  // mc pode estar desatualizado logo após trocar de time
  const fresh = mc != null && mc.myPos.length > 0 && mc.myPos[0] > 0;

  const g = goal ?? autoGoal;

  const info = useMemo(() => {
    if (!mc || !fresh) return null;
    const p = goalProb(mc, g, n);
    const likely = pointsNeeded(mc, g, 0.5);
    const safe = pointsNeeded(mc, g, 0.9);
    return { p, likely, safe, keys: keyGames(mc, g, n, team.id, 6) };
  }, [mc, fresh, g, n, team.id]);

  return (
    <section className="card overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[1.1fr_1fr]">
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={team.escudo} alt="" width={52} height={52} className="w-[52px] h-[52px]" />
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold tracking-tight truncate">{team.name}</h1>
              <p className="text-sm text-muted tnum">
                {pos}º lugar · {row.pts} pts em {row.j} jogos · {left} jogo{left === 1 ? "" : "s"} sem palpite
              </p>
            </div>
            <button onClick={onChangeTeam} className="text-xs underline text-muted shrink-0">trocar time</button>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <Chance label="Título" p={odds?.title} good />
            <Chance label="Liberta" p={odds?.g6} good />
            <Chance label="Sula" p={odds?.sula} good />
            <Chance label="Cair" p={odds?.z4} />
          </div>

          <div>
            <div className="text-xs text-muted mb-1">Onde o {team.name} termina (todas as posições)</div>
            <PosChart dist={odds?.posDist} n={n} />
          </div>

          <label className="flex items-center gap-2 text-xs">
            <span className="shrink-0">Como o time está?</span>
            <input type="range" min={-25} max={25} value={momento} onChange={(e) => setMomento(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
            <span className={`w-16 text-right ${momento > 0 ? "text-home" : momento < 0 ? "text-away" : "text-muted"}`}>{momentoLabel(momento)}</span>
          </label>
        </div>

        <div className="p-4 space-y-3 bg-bg/60 border-t lg:border-t-0 lg:border-l border-line">
          <div className="flex flex-wrap gap-1">
            {(Object.keys(GOALS) as GoalKey[]).map((k) => (
              <button key={k} onClick={() => setGoal(k)}
                className={`text-xs rounded-full border px-2.5 py-1 ${g === k ? "bg-fg text-bg border-fg" : "border-line bg-card hover:border-fg"}`}>
                {GOALS[k].label}
              </button>
            ))}
          </div>

          {!info ? (
            <div className="h-40 animate-pulse rounded-lg bg-line/40" />
          ) : (
            <>
              <Verdict goal={g} p={info.p} pts={realPts} left={left} likely={info.likely} safe={info.safe} team={team.name} />
              <KeyList title="Seus jogos decisivos" hint="Os jogos do seu time que mais pesam. Clique para aplicar o palpite."
                games={info.keys.mine} teams={teams} myTeam={team.id} onApply={onApply} />
              <KeyList title="Para quem torcer" hint={scenarioLabel ? `Com o cenário “${scenarioLabel}”, os outros jogos já estão definidos. Volte para “Deixar o modelo simular” para ver para quem torcer.` : `Jogos de outros times que mais mudam sua chance de “${GOALS[g].label.toLowerCase()}”.`}
                games={info.keys.rivals} teams={teams} myTeam={team.id} onApply={onApply} />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function KeyList({ title, hint, games, teams, myTeam, onApply }: {
  title: string; hint: string; games: KeyGame[]; teams: Map<number, SimTeam>; myTeam: number; onApply: (f: Fixture, o: 0 | 1 | 2) => void;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-[11px] text-muted mb-1.5">{hint}</p>
      <ul className="space-y-1">
        {games.map((k) => {
          const f = k.fixture, h = teams.get(f.home)!, a = teams.get(f.away)!;
          const want = k.best === 0 ? h : k.best === 2 ? a : null;
          // chance média se o resultado desejado NÃO acontecer
          let num = 0, den = 0;
          k.p.forEach((p, i) => { if (i !== k.best && !Number.isNaN(p)) { num += p * k.freq[i]; den += k.freq[i]; } });
          const otherwise = den ? num / den : NaN;
          const mineWin = f.home === myTeam ? 0 : 2, mineLose = f.home === myTeam ? 2 : 0;
          const mine = f.home === myTeam || f.away === myTeam;
          return (
            <li key={f.id}>
              <button onClick={() => onApply(f, k.best)} className="w-full text-left rounded-lg bg-card border border-line hover:border-accent px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted tnum w-8">{f.round}ª</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={h.escudo} alt="" width={16} height={16} className="w-4 h-4" />
                  <span className={k.best === 0 ? "font-semibold" : ""}>{h.name}</span>
                  <span className="text-muted">x</span>
                  <span className={k.best === 2 ? "font-semibold" : ""}>{a.name}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.escudo} alt="" width={16} height={16} className="w-4 h-4" />
                </div>
                <div className="text-xs mt-0.5 tnum">
                  {mine ? (
                    <>Vitória → <b className="text-home">{pct(k.p[mineWin])}</b> · empate → {pct(k.p[1])} · derrota → <b className="text-away">{pct(k.p[mineLose])}</b></>
                  ) : (
                    <>
                      Torça {want ? <>pelo <b>{want.name}</b></> : <>pelo <b>empate</b></>} → <b className="text-home">{pct(k.p[k.best])}</b>
                      <span className="text-muted"> (senão, {pct(otherwise)})</span>
                    </>
                  )}
                </div>
              </button>
            </li>
          );
        })}
        {games.length === 0 && !hint.startsWith("Com o cenário") && <li className="text-xs text-muted">Nenhum jogo muda essa chance de forma relevante.</li>}
      </ul>
    </div>
  );
}

function Chance({ label, p, good }: { label: string; p?: number; good?: boolean }) {
  const color = good ? "var(--home)" : "var(--away)";
  return (
    <div className="rounded-lg bg-bg p-2">
      <div className="text-[11px] text-muted truncate">{label}</div>
      <div className="text-lg font-bold tnum" style={{ color: p && p >= 0.01 ? color : undefined }}>
        {p == null ? "…" : p === 0 ? "0%" : p >= 0.995 ? "100%" : pct(p)}
      </div>
    </div>
  );
}

function PosChart({ dist, n }: { dist?: number[]; n: number }) {
  const max = Math.max(0.0001, ...(dist ?? [0]));
  return (
    <div className="flex items-end gap-0.5 h-20">
      {Array.from({ length: n }, (_, i) => {
        const p = dist?.[i] ?? 0;
        const z = zoneOf(i + 1, n);
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${i + 1}º: ${pct(p, 1)}`}>
            <div className="w-full rounded-t-sm" style={{ height: `${(p / max) * 100}%`, minHeight: p > 0 ? 2 : 0, background: z ? ZONE_BAR[z] : "var(--draw)" }} />
            <span className="text-[9px] text-muted tnum mt-0.5">{i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}

function Verdict({ goal, p, pts, left, likely, safe, team }: { goal: GoalKey; p: number; pts: number; left: number; likely: number; safe: number; team: string }) {
  const needLikely = likely - pts, needSafe = safe - pts;
  const max = left * 3;
  const plan = (need: number) => {
    if (need <= 0) return "já garantido na maioria dos cenários";
    if (need > max) return `precisaria de ${need} pts, mas só restam ${max} em disputa`;
    let wins = Math.floor(need / 3), draws = need % 3;
    if (wins + draws > left) { wins = Math.ceil(need / 3); draws = 0; }
    const ex = [wins && `${wins} vitória${wins > 1 ? "s" : ""}`, draws && `${draws} empate${draws > 1 ? "s" : ""}`].filter(Boolean).join(" e ");
    return `faltam ${need} pts em ${left} jogos (${Math.round((need / max) * 100)}% de aproveitamento) · ex.: ${ex}`;
  };
  const tone = p >= 0.9 ? "text-home" : p <= 0.1 ? "text-away" : "";
  return (
    <div className="rounded-lg bg-card border border-line p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">Chance de {GOALS[goal].label.toLowerCase()}</span>
        <span className={`text-3xl font-bold tnum ${tone}`}>{p >= 0.995 ? "100%" : p > 0 && p < 0.005 ? "<1%" : pct(p)}</span>
      </div>
      <div className="text-xs space-y-1">
        <div><b className="tnum">~{likely} pts</b> deve bastar (50%): {plan(needLikely)}.</div>
        <div><b className="tnum">~{safe} pts</b> dá segurança (90%): {plan(needSafe)}.</div>
      </div>
      {goal === "fuga" && p < 0.5 && <p className="text-xs text-away">Situação delicada para o {team}: os jogos marcados como “seu jogo” abaixo são finais.</p>}
    </div>
  );
}
