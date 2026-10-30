import { getDb } from "@/lib/data";
import { ratings } from "@/lib/analysis";
import TieLab from "@/components/TieLab";

export const dynamic = "force-dynamic";

export default async function Confronto(props: PageProps<"/confronto">) {
  const sp = await props.searchParams;
  const db = getDb();
  const r = ratings(db);
  // Só times com amostra mínima: o resto teria força quase toda vinda do prior
  const teams = [...db.teams.values()]
    .filter((t) => (r.teams[t.id]?.n ?? 0) >= 4)
    .sort((x, y) => x.name.localeCompare(y.name, "pt-BR"))
    .map(({ id, name, sigla, escudo }) => ({ id, name, sigla, escudo }));
  const ids = new Set(teams.map((t) => t.id));
  const subset = { mu: r.mu, home: r.home, teams: Object.fromEntries(Object.entries(r.teams).filter(([id]) => ids.has(Number(id)))) };
  const num = (v: unknown) => (typeof v === "string" && ids.has(Number(v)) ? Number(v) : undefined);
  const modo = sp.modo === "unico" || sp.modo === "neutro" || sp.modo === "ida-volta" ? sp.modo : undefined;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Simular confronto</h1>
        <p className="text-sm text-muted">Mata-mata entre quaisquer dois times com histórico suficiente: jogo único, ida e volta ou final neutra.</p>
      </div>
      <TieLab teams={teams} ratings={subset} initial={{ a: num(sp.a), b: num(sp.b), modo }} />
    </div>
  );
}
