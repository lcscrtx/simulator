"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { expectedGoals, matchProbs, type Ratings } from "@/lib/model";
import {
  GOALS, SCENARIOS, expectedFinal, findRivals, goalProb, likelyScore, liveTable, momentoLabel, monteCarlo, scenarioPicks, zoneOf,
  projectedTable, type BaseRow, type Fixture, type Played, type GoalKey, type MonteCarlo, type Pick, type Picks, type ScenarioKey,
} from "@/lib/sim";
import MyTeamPanel from "./MyTeamPanel";
import ShareBar, { decodeState } from "./Share";
import { pct } from "../ui";

export type SimTeam = { id: number; name: string; sigla: string; escudo: string };
type Scenario = { kind: ScenarioKey; seed: number; horizon: number };
type Saved = { picks: Picks; myTeam: number | null; adj: Record<number, number>; goal: GoalKey | null; scenario: Scenario };
type Probs = ReturnType<typeof matchProbs>;

const ZONE_COLOR: Record<string, string> = { lib: "#1d4ed8", pre: "#60a5fa", sula: "#16a34a", z4: "#dc2626" };
const HORIZONS = [[1, "Próxima rodada"], [5, "Próximas 5"], [99, "Até o fim"]] as const;
const DEFAULT_SCENARIO: Scenario = { kind: "simular", seed: 1, horizon: 99 };

export default function Simulator({ teams, base, fixtures, played, ratings, season, estimatedRounds }: {
  teams: SimTeam[]; base: BaseRow[]; fixtures: Fixture[]; played: Played[]; ratings: Ratings; season: number; estimatedRounds: boolean;
}) {
  // Link compartilhado (?s=...) abre a simulação de outra pessoa; ela fica salva à parte para não
  // apagar a simulação do próprio visitante
  const [shared] = useState(() => {
    const code = new URLSearchParams(location.search).get("s");
    return code ? decodeState(code) : null;
  });
  const key = `simbr:v2:${season}${shared ? ":amigo" : ""}`;
  // Renderizado só no navegador (ver SimulatorClient), então dá para ler o localStorage direto
  const [saved] = useState<Partial<Saved>>(() => {
    if (shared) return { ...shared, scenario: shared.scenario as Scenario, goal: null };
    try { return JSON.parse(localStorage.getItem(key) ?? "{}") ?? {}; } catch { return {}; }
  });
  const [picks, setPicks] = useState<Picks>(saved.picks ?? {}); // palpites manuais
  const [myTeam, setMyTeam] = useState<number | null>(saved.myTeam ?? null);
  const [adj, setAdj] = useState<Record<number, number>>(saved.adj ?? {});
  const [goal, setGoal] = useState<GoalKey | null>(saved.goal ?? null);
  const [scenario, setScenario] = useState<Scenario>(saved.scenario ?? DEFAULT_SCENARIO);
  const rounds = useMemo(() => [...new Set(fixtures.map((f) => f.round))].sort((a, b) => a - b), [fixtures]);
  const [round, setRound] = useState(rounds[0]);
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify({ picks, myTeam, adj, goal, scenario } satisfies Saved)); } catch {}
  }, [key, picks, myTeam, adj, goal, scenario]);

  // Gols esperados de cada jogo, já com o "momento" que o usuário deu a cada time
  const xg = useMemo(() => {
    const m = new Map<number, [number, number]>();
    const a = (id: number) => ({ att: 1 + (adj[id] ?? 0) / 100, def: 1 - (adj[id] ?? 0) / 200 });
    for (const f of fixtures) m.set(f.id, expectedGoals(ratings, f.home, f.away, { adjHome: a(f.home), adjAway: a(f.away) }));
    return m;
  }, [fixtures, ratings, adj]);
  const probs = useMemo(() => new Map([...xg].map(([id, x]) => [id, matchProbs(...x)])), [xg]);

  const isMine = useCallback((f: Fixture) => f.home === myTeam || f.away === myTeam, [myTeam]);
  const myGames = useMemo(() => fixtures.filter(isMine), [fixtures, isMine]);

  // Projeção só com os palpites manuais: define rivais diretos e o objetivo padrão (não muda com o cenário)
  const expFinal = useMemo(() => expectedFinal(base, fixtures, picks, probs), [base, fixtures, picks, probs]);
  const autoGoal = useMemo((): GoalKey => {
    if (myTeam == null) return "fuga";
    const sorted = [...expFinal.values()].sort((a, b) => b - a);
    const rank = sorted.indexOf(expFinal.get(myTeam)!) + 1, n = sorted.length;
    return rank <= 2 ? "titulo" : rank <= 6 ? "g6" : rank <= n - 7 ? "sula" : "fuga";
  }, [expFinal, myTeam]);
  const rivals = useMemo(() => (myTeam == null ? [] : findRivals(expFinal, myTeam, goal ?? autoGoal)), [expFinal, myTeam, goal, autoGoal]);

  // Jogos dos outros times preenchidos pelo cenário; palpite manual sempre vence
  const scen = useMemo(() => {
    const last = rounds[0] + scenario.horizon - 1;
    const games = fixtures.filter((f) => !isMine(f) && !picks[f.id] && f.round <= last);
    return scenarioPicks(scenario.kind, games, probs, new Set(rivals), scenario.seed);
  }, [fixtures, rounds, scenario, isMine, picks, probs, rivals]);
  const eff = useMemo(() => ({ ...scen, ...picks }), [scen, picks]);

  // Visão "final": jogos ainda sem resultado (sem palpite e fora do cenário) entram pelos pontos esperados,
  // a mesma base das chances. Sem isso, quem tem mais palpites aparece artificialmente na frente.
  const [view, setView] = useState<"final" | "agora">("final");
  const { table, approx } = useMemo(
    () => (view === "agora" ? { table: liveTable(base, fixtures, eff, played), approx: new Set<number>() } : projectedTable(base, fixtures, eff, probs, played)),
    [base, fixtures, eff, probs, view, played],
  );
  const basePos = useMemo(() => new Map(liveTable(base, fixtures, {}, played).map((r, i) => [r.id, i + 1])), [base, fixtures, played]);

  // Monte Carlo com pequeno atraso: vários cliques seguidos geram um só recálculo
  const inputs = useMemo(() => ({ eff, xg, myTeam }), [eff, xg, myTeam]);
  const [sim, setSim] = useState<{ inputs: typeof inputs; mc: MonteCarlo } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setSim({ inputs, mc: monteCarlo(base, fixtures, inputs.eff, inputs.xg, inputs.myTeam, 4000) }), 120);
    return () => clearTimeout(t);
  }, [base, fixtures, inputs]);
  const mc = sim?.mc ?? null;
  const busy = sim?.inputs !== inputs;

  const setPick = useCallback((id: number, p: Pick | null) => setPicks((s) => {
    const n = { ...s };
    if (p) n[id] = p; else delete n[id];
    return n;
  }), []);
  const pickOutcome = useCallback((id: number, o: 0 | 1 | 2) => setPick(id, likelyScore(probs.get(id)!.matrix, o)), [probs, setPick]);

  /** Preenche os jogos do meu time com um padrão (resultado do ponto de vista do meu time). */
  const fillMine = (rule: (f: Fixture, home: boolean) => "v" | "e" | "d" | null) => setPicks((s) => {
    const n = { ...s };
    for (const f of myGames) {
      const home = f.home === myTeam, r = rule(f, home);
      if (r == null) { delete n[f.id]; continue; }
      const o = r === "e" ? 1 : (r === "v") === home ? 0 : 2;
      n[f.id] = likelyScore(probs.get(f.id)!.matrix, o);
    }
    return n;
  });
  const myFav = (f: Fixture) => {
    const p = probs.get(f.id)!, home = f.home === myTeam;
    const [w, l] = home ? [p.home, p.away] : [p.away, p.home];
    return w >= 0.45 ? "v" : l >= 0.45 ? "d" : "e"; // mesma régua do cenário "Tudo na lógica"
  };

  if (myTeam == null) return <TeamPicker teams={teams} onPick={setMyTeam} base={table} />;
  const me = byId.get(myTeam)!;
  const myIds = new Set(myGames.map((f) => f.id));
  const otherManual = Object.keys(picks).filter((id) => !myIds.has(Number(id))).length;
  const scenCount = Object.keys(scen).length;
  const n = table.length;
  const picked = Object.keys(eff).length;
  const rivalTeams = rivals.map((id) => byId.get(id)).filter((t): t is SimTeam => t != null);

  // Manchete para compartilhar: sempre pela tabela final projetada, independente da visão escolhida
  const proj = projectedTable(base, fixtures, eff, probs, played).table;
  const projPos = proj.findIndex((r) => r.id === myTeam) + 1;
  const g = goal ?? autoGoal;
  const fresh = mc != null && !busy && mc.myPos[0] > 0;
  const headline = `${me.name} termina em ${projPos}º com ~${proj[projPos - 1].pts} pontos`;
  const detail = `${fresh ? `Chance de ${GOALS[g].label.toLowerCase()}: ${pct(goalProb(mc, g, n))}.` : ""}${scenario.kind !== "simular" ? ` Outros jogos: ${SCENARIOS[scenario.kind].label.replace(/^Cenário /, "").toLowerCase()}.` : ""}`;

  return (
    <div className="space-y-5">
      {shared && (
        <div className="rounded-lg border border-accent bg-accent/10 px-3 py-2 text-sm flex flex-wrap items-center gap-2">
          <span>👀 Você está vendo uma <b>simulação compartilhada</b>. Pode mexer à vontade: a sua simulação continua salva.</span>
          <a href={location.pathname} className="ml-auto text-xs underline">Voltar para a minha</a>
        </div>
      )}
      <MyTeamPanel
        team={me}
        teams={byId}
        table={table}
        mc={mc}
        busy={busy}
        goal={goal}
        setGoal={setGoal}
        momento={adj[myTeam] ?? 0}
        setMomento={(v) => setAdj((s) => ({ ...s, [myTeam]: v }))}
        onChangeTeam={() => setMyTeam(null)}
        onApply={(f, o) => pickOutcome(f.id, o)}
        fixtures={fixtures}
        picks={eff}
        scenarioLabel={scenario.kind === "simular" ? null : SCENARIOS[scenario.kind].label}
        autoGoal={autoGoal}
        realPts={liveTable(base, fixtures, eff).find((r) => r.id === myTeam)?.pts ?? 0}
      />
      <ShareBar state={{ myTeam, picks, scenario, adj }} team={me} table={proj} teams={byId} headline={headline} detail={detail} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-5 min-w-0">
          {/* 1. Jogos do meu time */}
          <section className="card p-3 space-y-3">
            <div>
              <h2 className="font-semibold">1. Jogos do {me.name}</h2>
              <p className="text-xs text-muted">Você decide os jogos do seu time. Os que ficarem sem palpite, o modelo simula.
                {estimatedRounds && " A ordem das rodadas é estimada (a fonte de dados não traz o calendário)."}</p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Btn onClick={() => fillMine(() => "v")}>Vence tudo</Btn>
              <Btn onClick={() => fillMine((_, home) => (home ? "v" : "e"))}>Vence em casa, empata fora</Btn>
              <Btn onClick={() => fillMine(myFav)}>Na lógica</Btn>
              <Btn onClick={() => fillMine(() => "d")}>Perde tudo</Btn>
              <Btn onClick={() => fillMine(() => null)}>Limpar</Btn>
            </div>
            <ul className="divide-y divide-line max-h-[34rem] overflow-y-auto -mx-1 px-1">
              {myGames.map((f) => (
                <MyGameRow key={f.id} f={f} myTeam={myTeam} opp={byId.get(f.home === myTeam ? f.away : f.home)!} pick={picks[f.id]}
                  probs={probs.get(f.id)!} onPick={(p) => setPick(f.id, p)} onOutcome={(o) => pickOutcome(f.id, o)} />
              ))}
            </ul>
          </section>

          {/* 2. Cenário para o resto */}
          <section className="card p-3 space-y-3">
            <div>
              <h2 className="font-semibold">2. E os outros jogos?</h2>
              <p className="text-xs text-muted">Escolha um cenário e todos os jogos dos outros times são preenchidos de uma vez.</p>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(SCENARIOS) as ScenarioKey[]).map((k) => {
                const s = SCENARIOS[k], on = scenario.kind === k;
                return (
                  <button key={k} onClick={() => setScenario((c) => ({ ...c, kind: k, seed: on && s.random ? c.seed + 1 : c.seed }))}
                    className={`text-left rounded-lg border p-2 transition ${on ? "border-accent bg-accent/10" : "border-line hover:border-accent"} ${k === "simular" ? "col-span-2" : ""}`}>
                    <div className="text-sm font-medium">{s.icon} {s.label}</div>
                    <div className="text-[11px] text-muted leading-snug">{s.desc}</div>
                  </button>
                );
              })}
            </div>
            {scenario.kind !== "simular" && (
              <div className="space-y-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted">Aplicar em:</span>
                  {HORIZONS.map(([h, l]) => (
                    <Btn key={h} active={scenario.horizon === h} onClick={() => setScenario((c) => ({ ...c, horizon: h }))}>{l}</Btn>
                  ))}
                  {SCENARIOS[scenario.kind].random && <Btn onClick={() => setScenario((c) => ({ ...c, seed: c.seed + 1 }))}>🔄 Sortear de novo</Btn>}
                </div>
                <p className="text-muted">
                  {scenCount} jogos preenchidos pelo cenário{otherManual ? ` · ${otherManual} editados por você` : ""}.
                  {scenario.horizon < 99 && " Depois disso, o modelo simula."}
                </p>
              </div>
            )}
            {(scenario.kind === "otimista" || scenario.kind === "pessimista") && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted">Rivais diretos:</span>
                {rivalTeams.length === 0 ? <span className="text-muted">nenhum time perto na projeção</span> : rivalTeams.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-bg border border-line px-2 py-0.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.escudo} alt="" width={14} height={14} className="w-3.5 h-3.5" />{t.name}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* 3. Ajuste fino */}
          <details className="card p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              3. Ver e editar jogo a jogo
              <span className="block text-xs font-normal text-muted">Opcional: confira o que o cenário colocou ou mude um resultado específico.</span>
            </summary>
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2">
                <button className="rounded-md border border-line w-8 h-8 disabled:opacity-30" disabled={round === rounds[0]} onClick={() => setRound(rounds[rounds.indexOf(round) - 1])} aria-label="Rodada anterior">‹</button>
                <select value={round} onChange={(e) => setRound(Number(e.target.value))} className="flex-1 rounded-md border border-line bg-card h-8 px-2 text-sm font-semibold">
                  {rounds.map((r) => <option key={r} value={r}>{r}ª rodada</option>)}
                </select>
                <button className="rounded-md border border-line w-8 h-8 disabled:opacity-30" disabled={round === rounds.at(-1)} onClick={() => setRound(rounds[rounds.indexOf(round) + 1])} aria-label="Próxima rodada">›</button>
              </div>
              <ul className="divide-y divide-line">
                {fixtures.filter((f) => f.round === round).map((f) => (
                  <FixtureRow key={f.id} f={f} home={byId.get(f.home)!} away={byId.get(f.away)!} pick={eff[f.id]} fromScenario={!picks[f.id] && !!scen[f.id]}
                    probs={probs.get(f.id)!} mine={isMine(f)}
                    onPick={(p) => setPick(f.id, p)} onOutcome={(o) => pickOutcome(f.id, o)} />
                ))}
              </ul>
              <div className="flex justify-end">
                <Btn onClick={() => { if (confirm("Apagar todos os palpites e voltar ao cenário padrão?")) { setPicks({}); setScenario(DEFAULT_SCENARIO); } }}>Zerar tudo</Btn>
              </div>
            </div>
          </details>
        </div>

        {/* Tabela ao vivo */}
        <section className="card overflow-hidden self-start lg:sticky lg:top-4">
          <div className="flex items-center justify-between px-3 py-2 border-b border-line">
            <div>
              <div className="flex items-center gap-1 text-xs">
                <Btn active={view === "final"} onClick={() => setView("final")}>Final projetada</Btn>
                <Btn active={view === "agora"} onClick={() => setView("agora")}>{picked ? "Até agora + palpites" : "Até agora"}</Btn>
              </div>
              <p className="text-[11px] text-muted mt-1">
                {view === "final" ? "≈ inclui os pontos esperados dos jogos ainda sem resultado." : "Só jogos disputados e com palpite/cenário."}
              </p>
            </div>
            <span className={`text-xs text-muted ${busy ? "animate-pulse" : ""}`}>{busy ? "recalculando…" : `chances em ${mc?.sims.toLocaleString("pt-BR") ?? "…"} simulações`}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tnum">
              <thead className="text-[11px] text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 pl-3 text-left" colSpan={2}>Time</th>
                  <th className="px-1.5">P</th>
                  <th className="px-1.5">J</th>
                  <th className="px-1.5 hidden sm:table-cell">V</th>
                  <th className="px-1.5">SG</th>
                  <th className="px-1.5 border-l border-line" title="Chance de título">Título</th>
                  <th className="px-1.5" title="Chance de G6 (Libertadores)">Liberta</th>
                  <th className="px-1.5 pr-3" title="Chance de rebaixamento">Cair</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r, i) => {
                  const pos = i + 1, t = byId.get(r.id)!, z = zoneOf(pos, n), m = mc?.teams.get(r.id);
                  const diff = (basePos.get(r.id) ?? pos) - pos;
                  const rival = rivals.includes(r.id) && (scenario.kind === "otimista" || scenario.kind === "pessimista");
                  return (
                    <tr key={r.id} className={`border-b border-line last:border-0 ${r.id === myTeam ? "bg-accent/10 font-semibold" : ""}`}>
                      <td className="py-1 pl-3 w-10" style={{ boxShadow: z ? `inset 3px 0 0 ${ZONE_COLOR[z]}` : undefined }}>
                        <span className="pl-1">{pos}</span>
                        {diff !== 0 && <span className={`ml-0.5 text-[10px] ${diff > 0 ? "text-home" : "text-away"}`}>{diff > 0 ? "▲" : "▼"}{Math.abs(diff)}</span>}
                      </td>
                      <td className="py-1">
                        <button className="flex items-center gap-1.5 whitespace-nowrap hover:underline" onClick={() => setMyTeam(r.id)} title="Definir como meu time">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={t.escudo} alt="" width={18} height={18} className="w-[18px] h-[18px]" />
                          <span className="hidden sm:inline">{t.name}</span><span className="sm:hidden">{t.sigla}</span>
                          {rival && <span className="text-[10px] font-normal text-muted">rival</span>}
                        </button>
                      </td>
                      <td className="px-1.5 text-center font-semibold">{approx.has(r.id) ? "≈" : ""}{r.pts}</td>
                      <td className="px-1.5 text-center text-muted">{r.j}</td>
                      <td className="px-1.5 text-center hidden sm:table-cell">{r.w}</td>
                      <td className="px-1.5 text-center">{r.sg}</td>
                      <Odd p={m?.title} color="--home" border />
                      <Odd p={m?.g6} color="--home" />
                      <Odd p={m?.z4} color="--away" last />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3 px-3 py-2 border-t border-line text-[11px] text-muted">
            {[["lib", "Libertadores"], ["pre", "Pré-Libertadores"], ["sula", "Sul-Americana"], ["z4", "Rebaixamento"]].map(([z, l]) => (
              <span key={z} className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ZONE_COLOR[z] }} />{l}</span>
            ))}
            <span className="ml-auto">Clique num time para torná-lo o seu.</span>
          </div>
        </section>
      </div>

      <AdjustTeams teams={teams} adj={adj} setAdj={setAdj} />
    </div>
  );
}

function Odd({ p, color, border, last }: { p?: number; color: string; border?: boolean; last?: boolean }) {
  return (
    <td className={`px-1.5 text-center text-xs ${border ? "border-l border-line" : ""} ${last ? "pr-3" : ""}`}
      style={p != null ? { background: `color-mix(in oklab, var(${color}) ${Math.round(p * 60)}%, transparent)` } : undefined}>
      {p == null ? "…" : p === 0 ? "–" : p >= 0.995 ? "100%" : pct(p)}
    </td>
  );
}

function Btn({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} className={`rounded-md border px-2 py-1 ${active ? "bg-accent text-white border-accent" : "border-line hover:border-accent"}`}>
      {children}
    </button>
  );
}

function ScoreInput({ value, onChange, label, muted }: { value: number | undefined; onChange: (v: number | null) => void; label: string; muted?: boolean }) {
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={value ?? ""}
      onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 2); onChange(v === "" ? null : Number(v)); }}
      onFocus={(e) => e.target.select()}
      className={`w-9 h-9 rounded-md border bg-bg text-center text-base focus:border-accent outline-none ${muted ? "border-dashed border-line text-muted" : "border-line font-semibold"}`}
    />
  );
}

const outcomeOf = (p?: Pick) => (p ? (p.h > p.a ? 0 : p.h === p.a ? 1 : 2) : null);

/** Jogo do meu time: botões grandes de Vitória/Empate/Derrota do ponto de vista do torcedor. */
function MyGameRow({ f, myTeam, opp, pick, probs, onPick, onOutcome }: {
  f: Fixture; myTeam: number; opp: SimTeam; pick?: Pick; probs: Probs; onPick: (p: Pick | null) => void; onOutcome: (o: 0 | 1 | 2) => void;
}) {
  const home = f.home === myTeam;
  const res = outcomeOf(pick);
  const win: 0 | 2 = home ? 0 : 2, lose: 0 | 2 = home ? 2 : 0;
  const pw = home ? probs.home : probs.away, pl = home ? probs.away : probs.home;
  const opt = (o: 0 | 1 | 2, label: string, p: number, tone: string) => (
    <button onClick={() => (res === o ? onPick(null) : onOutcome(o))}
      className={`flex-1 rounded-md py-1.5 text-xs font-medium tnum border ${res === o ? `${tone} text-white border-transparent` : "border-line hover:border-accent"}`}>
      {label} <span className={res === o ? "opacity-80" : "text-muted font-normal"}>{pct(p)}</span>
    </button>
  );
  return (
    <li className="py-2 space-y-1.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[11px] text-muted tnum w-8 shrink-0">{f.round}ª</span>
        <span className="text-[11px] rounded px-1 bg-bg text-muted shrink-0">{home ? "casa" : "fora"}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={opp.escudo} alt="" width={20} height={20} className="w-5 h-5" />
        <span className="truncate flex-1">{opp.name}</span>
        {pick && <span className="tnum text-xs text-muted">{pick.h}x{pick.a}</span>}
      </div>
      <div className="flex gap-1">
        {opt(win, "Vitória", pw, "bg-home")}
        {opt(1, "Empate", probs.draw, "bg-draw")}
        {opt(lose, "Derrota", pl, "bg-away")}
      </div>
    </li>
  );
}

function FixtureRow({ f, home, away, pick, fromScenario, probs, mine, onPick, onOutcome }: {
  f: Fixture; home: SimTeam; away: SimTeam; pick?: Pick; fromScenario: boolean; probs: Probs; mine: boolean;
  onPick: (p: Pick | null) => void; onOutcome: (o: 0 | 1 | 2) => void;
}) {
  const res = outcomeOf(pick);
  const set = (side: "h" | "a", v: number | null) => {
    if (v == null) return onPick(null);
    onPick({ h: side === "h" ? v : pick?.h ?? 0, a: side === "a" ? v : pick?.a ?? 0 });
  };
  const opt = (o: 0 | 1 | 2, label: string, p: number) => (
    <button onClick={() => (res === o && !fromScenario ? onPick(null) : onOutcome(o))}
      className={`flex-1 rounded px-1 py-0.5 tnum ${res === o ? (fromScenario ? "bg-accent/25" : "bg-accent text-white") : "bg-bg hover:bg-line"}`}>
      {label} <span className={res === o && !fromScenario ? "opacity-80" : "text-muted"}>{pct(p)}</span>
    </button>
  );
  return (
    <li className={`py-2 px-1 ${mine ? "bg-accent/5 -mx-1 px-2 rounded" : ""}`}>
      <div className="text-[11px] text-muted mb-1 flex justify-between">
        <span>{f.date ? new Date(f.date).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }) : "data a definir"}</span>
        {fromScenario && <span>pelo cenário</span>}
      </div>
      <div className="grid grid-cols-[1fr_auto_auto_auto_1fr] items-center gap-1.5">
        <span className="flex items-center justify-end gap-1.5 text-sm truncate">
          <span className="truncate">{home.name}</span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={home.escudo} alt="" width={22} height={22} className="w-[22px] h-[22px]" />
        </span>
        <ScoreInput value={pick?.h} onChange={(v) => set("h", v)} label={`Gols ${home.name}`} muted={fromScenario} />
        <span className="text-muted text-xs">x</span>
        <ScoreInput value={pick?.a} onChange={(v) => set("a", v)} label={`Gols ${away.name}`} muted={fromScenario} />
        <span className="flex items-center gap-1.5 text-sm truncate">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={away.escudo} alt="" width={22} height={22} className="w-[22px] h-[22px]" />
          <span className="truncate">{away.name}</span>
        </span>
      </div>
      <div className="mt-1.5 flex gap-1 text-[11px]">
        {opt(0, home.sigla, probs.home)}
        {opt(1, "Empate", probs.draw)}
        {opt(2, away.sigla, probs.away)}
      </div>
    </li>
  );
}

function TeamPicker({ teams, onPick, base }: { teams: SimTeam[]; onPick: (id: number) => void; base: { id: number }[] }) {
  const order = new Map(base.map((r, i) => [r.id, i]));
  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return (
    <div className="card p-6 text-center space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Qual é o seu time?</h1>
        <p className="text-sm text-muted">Você simula os jogos dele, escolhe um cenário para o resto e vê as chances na hora.</p>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-w-3xl mx-auto">
        {sorted.map((t) => (
          <button key={t.id} onClick={() => onPick(t.id)} className="rounded-xl border border-line p-3 hover:border-accent hover:bg-bg flex flex-col items-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={t.escudo} alt="" width={40} height={40} className="w-10 h-10" />
            <span className="text-xs font-medium">{t.name}</span>
            <span className="text-[10px] text-muted">{(order.get(t.id) ?? 0) + 1}º</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AdjustTeams({ teams, adj, setAdj }: { teams: SimTeam[]; adj: Record<number, number>; setAdj: (f: (s: Record<number, number>) => Record<number, number>) => void }) {
  const changed = Object.values(adj).filter((v) => v !== 0).length;
  return (
    <details className="card p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        Momento dos times {changed > 0 && <span className="text-accent font-normal">({changed} ajustado{changed > 1 ? "s" : ""})</span>}
        <span className="block text-xs font-normal text-muted">Acha que o modelo está subestimando alguém? Técnico novo, reforço, crise… ajuste e tudo é recalculado.</span>
      </summary>
      <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {[...teams].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((t) => {
          const v = adj[t.id] ?? 0;
          return (
            <label key={t.id} className="flex items-center gap-2 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.escudo} alt="" width={16} height={16} className="w-4 h-4" />
              <span className="w-24 truncate">{t.name}</span>
              <input type="range" min={-25} max={25} value={v} onChange={(e) => setAdj((s) => ({ ...s, [t.id]: Number(e.target.value) }))} className="flex-1 accent-[var(--accent)]" />
              <span className={`tnum w-16 text-right ${v > 0 ? "text-home" : v < 0 ? "text-away" : "text-muted"}`}>{momentoLabel(v)}</span>
            </label>
          );
        })}
      </div>
      {changed > 0 && <button className="mt-3 text-xs underline text-muted" onClick={() => setAdj(() => ({}))}>Zerar ajustes</button>}
    </details>
  );
}
