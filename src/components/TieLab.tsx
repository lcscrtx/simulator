"use client";

import { useMemo, useState } from "react";
import { simulateTie, type Ratings } from "@/lib/model";
import { Crest, ProbBar, pct } from "./ui";

type T = { id: number; name: string; sigla: string; escudo: string };
type Mode = "unico" | "neutro" | "ida-volta";

export default function TieLab({ teams, ratings, initial }: { teams: T[]; ratings: Ratings; initial: { a?: number; b?: number; modo?: Mode } }) {
  const [a, setA] = useState(initial.a ?? teams[0]?.id);
  const [b, setB] = useState(initial.b ?? teams[1]?.id);
  const [mode, setMode] = useState<Mode>(initial.modo ?? "ida-volta");
  const [formA, setFormA] = useState(0);
  const [formB, setFormB] = useState(0);
  const [leg1, setLeg1] = useState<[string, string]>(["", ""]);
  const ta = teams.find((t) => t.id === a), tb = teams.find((t) => t.id === b);
  const firstLeg = mode === "ida-volta" && leg1[0] !== "" && leg1[1] !== "" ? ([Number(leg1[0]), Number(leg1[1])] as [number, number]) : undefined;

  const res = useMemo(
    () =>
      a && b && a !== b
        ? simulateTie(ratings, a, b, {
            twoLegs: mode === "ida-volta",
            neutralFinal: mode === "neutro",
            firstLeg,
            adjA: { att: 1 + formA / 100, def: 1 - formA / 200 },
            adjB: { att: 1 + formB / 100, def: 1 - formB / 200 },
            sims: 20000,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a, b, mode, formA, formB, firstLeg?.[0], firstLeg?.[1], ratings],
  );

  const select = (v: number | undefined, set: (n: number) => void) => (
    <select value={v} onChange={(e) => set(Number(e.target.value))} className="w-full rounded-md border border-line bg-card p-2 text-sm">
      {teams.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-muted space-y-1">
            <span>{mode === "unico" ? "Mandante" : mode === "ida-volta" ? "Mandante na ida" : "Time A"}</span>
            {select(a, setA)}
          </label>
          <label className="text-xs text-muted space-y-1">
            <span>{mode === "unico" ? "Visitante" : mode === "ida-volta" ? "Mandante na volta" : "Time B"}</span>
            {select(b, setB)}
          </label>
        </div>
        <div className="flex flex-wrap gap-1 text-sm">
          {(
            [["ida-volta", "Ida e volta"], ["unico", "Jogo único"], ["neutro", "Final em campo neutro"]] as const
          ).map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)} className={`rounded-md border px-2 py-1 ${mode === k ? "bg-accent text-white border-accent" : "border-line"}`}>
              {label}
            </button>
          ))}
        </div>
        {mode === "ida-volta" && (
          <div className="text-sm flex items-center gap-2">
            <span className="text-muted text-xs">Ida já jogada?</span>
            {ta?.sigla}
            <input inputMode="numeric" value={leg1[0]} onChange={(e) => setLeg1([e.target.value.replace(/\D/g, ""), leg1[1]])} className="w-10 rounded border border-line bg-card p-1 text-center" />
            x
            <input inputMode="numeric" value={leg1[1]} onChange={(e) => setLeg1([leg1[0], e.target.value.replace(/\D/g, "")])} className="w-10 rounded border border-line bg-card p-1 text-center" />
            {tb?.sigla}
          </div>
        )}
        {[[ta, formA, setFormA], [tb, formB, setFormB]].map(([t, v, set], i) => (
          <label key={i} className="flex items-center gap-2 text-xs">
            <span className="w-28 truncate">Momento {(t as T | undefined)?.name}</span>
            <input type="range" min={-20} max={20} value={v as number} onChange={(e) => (set as (n: number) => void)(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
            <span className="tnum w-10 text-right">{(v as number) > 0 ? "+" : ""}{v as number}%</span>
          </label>
        ))}
      </div>

      <div className="card p-4 space-y-4">
        {!res || !ta || !tb ? (
          <p className="text-sm text-muted">Escolha dois times diferentes.</p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold"><Crest team={{ escudo: ta.escudo, name: ta.name }} size={32} />{ta.name}</span>
              <span className="text-xs text-muted">classificação</span>
              <span className="flex items-center gap-2 font-semibold">{tb.name}<Crest team={{ escudo: tb.escudo, name: tb.name }} size={32} /></span>
            </div>
            <ProbBar home={res.a} draw={0} away={res.b} labels={[ta.sigla, tb.sigla]} />
            <p className="text-xs text-muted">Decisão nos pênaltis em {pct(res.penalties)} das simulações (tratados como 50/50).</p>
            <LegBox title={mode === "ida-volta" ? `Ida: ${ta.sigla} x ${tb.sigla}` : `${ta.sigla} x ${tb.sigla}`} p={res.leg1} labels={[ta.sigla, tb.sigla]} />
            {res.leg2 && <LegBox title={`Volta: ${tb.sigla} x ${ta.sigla}`} p={res.leg2} labels={[tb.sigla, ta.sigla]} />}
          </>
        )}
      </div>
    </div>
  );
}

function LegBox({ title, p, labels }: { title: string; p: NonNullable<ReturnType<typeof simulateTie>["leg2"]>; labels: [string, string] }) {
  return (
    <div className="rounded-lg bg-bg p-3 space-y-1">
      <div className="text-xs font-medium">{title}</div>
      <ProbBar home={p.home} draw={p.draw} away={p.away} labels={labels} />
      <div className="text-xs text-muted tnum">
        xG {p.xg[0].toFixed(2)} – {p.xg[1].toFixed(2)} · placares: {p.top.slice(0, 3).map((s) => `${s.h}x${s.a} (${pct(s.p)})`).join(", ")}
      </div>
    </div>
  );
}
