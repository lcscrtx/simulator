import Link from "next/link";
import type { Match, Team } from "@/lib/data";

export const pct = (x: number, digits = 0) => (x < 0.005 && x > 0 ? "<1%" : `${(x * 100).toFixed(digits)}%`);

export function Crest({ team, size = 20 }: { team: Pick<Team, "escudo" | "name">; size?: number }) {
  // Times antigos do histórico (só no CSV) não têm escudo: mostra a inicial
  if (!team.escudo)
    return (
      <span className="inline-grid place-items-center shrink-0 rounded-full bg-line text-muted font-semibold" style={{ width: size, height: size, fontSize: size * 0.5 }}>
        {team.name.charAt(0)}
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={team.escudo} alt="" width={size} height={size} className="inline-block shrink-0" style={{ width: size, height: size }} />;
}

export function ProbBar({ home, draw, away, labels }: { home: number; draw: number; away: number; labels?: [string, string] }) {
  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full">
        <div className="bg-home" style={{ width: `${home * 100}%` }} />
        <div className="bg-draw" style={{ width: `${draw * 100}%` }} />
        <div className="bg-away" style={{ width: `${away * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs tnum">
        <span className="text-home font-medium">{labels?.[0] ?? "Casa"} {pct(home)}</span>
        {draw > 0 && <span className="text-muted">Empate {pct(draw)}</span>}
        <span className="text-away font-medium">{pct(away)} {labels?.[1] ?? "Fora"}</span>
      </div>
    </div>
  );
}

const FORM_STYLE: Record<string, string> = {
  v: "bg-home text-white",
  e: "bg-draw text-white",
  d: "bg-away text-white",
};

export function FormBadges({ form }: { form: string[] }) {
  return (
    <span className="inline-flex gap-0.5">
      {form.map((f, i) => (
        <span key={i} className={`inline-grid place-items-center w-4 h-4 rounded-sm text-[10px] font-bold uppercase ${FORM_STYLE[f]}`}>
          {f}
        </span>
      ))}
    </span>
  );
}

export const fmtDate = (iso: string) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "a definir";

export const fmtDay = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Sao_Paulo" }) : "";

export function Score({ m }: { m: Match }) {
  return m.hg != null && m.ag != null ? (
    <span className="tnum font-semibold">
      {m.hg} x {m.ag}
    </span>
  ) : (
    <span className="text-muted text-xs">vs</span>
  );
}

export function MatchLine({ m, href = true }: { m: Match; href?: boolean }) {
  const body = (
    <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
      <span className="flex items-center justify-end gap-1.5 text-right truncate">
        {m.home.name} <Crest team={m.home} size={18} />
      </span>
      <Score m={m} />
      <span className="flex items-center gap-1.5 truncate">
        <Crest team={m.away} size={18} /> {m.away.name}
      </span>
    </span>
  );
  return href ? (
    <Link href={`/partida/${m.id}`} className="block hover:bg-bg rounded px-1">
      {body}
    </Link>
  ) : (
    body
  );
}

export function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-semibold tracking-tight">{children}</h2>
      {sub && <p className="text-sm text-muted">{sub}</p>}
    </div>
  );
}
