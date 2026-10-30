import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { getDb } from "@/lib/data";
import { dataQuality } from "@/lib/analysis";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Simulador do Futebol Brasileiro",
  description: "Probabilidades, projeções e dados de partidas do Brasileirão, Copa do Brasil e Libertadores.",
};

const NAV = [
  ["/", "Simulador"],
  ["/rodadas", "Jogos"],
  // /projecao, /confronto, /copa-do-brasil e /libertadores seguem no ar, fora do menu até ganharem prioridade
] as const;

export default function RootLayout({ children }: LayoutProps<"/">) {
  const db = getDb();
  const quality = dataQuality(db);
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-card">
          <div className="mx-auto max-w-6xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" className="font-semibold tracking-tight">
              ⚽ Simulador BR
            </Link>
            <nav className="flex flex-wrap gap-4 text-sm text-muted">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} className="hover:text-fg">
                  {label}
                </Link>
              ))}
            </nav>
            {db.mode === "test" && (
              <span className="ml-auto text-xs rounded-full px-2 py-0.5 bg-amber-100 text-amber-900">
                Modo teste: dados fictícios
              </span>
            )}
            {db.mode === "csv" && db.source?.lastGame && (
              <span className="ml-auto text-xs rounded-full px-2 py-0.5 bg-accent/15 text-accent" title={`Fonte: ${db.source.label}`}>
                Dados reais até {new Date(db.source.lastGame).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })}
              </span>
            )}
          </div>
        </header>
        {!quality.ok && (
          <div className="mx-auto w-full max-w-6xl px-4 pt-4">
            <div className="rounded-lg border border-amber-300 bg-amber-50 text-amber-950 px-3 py-2 text-xs dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-800">
              <b>Dados incompletos:</b> somando jogos feitos e restantes, os times terminariam com {quality.min} a {quality.max} jogos
              (deveriam ser {quality.expected}). {quality.bad.length} times afetados, então pontuações e chances ficam distorcidas.
              {db.mode === "test" ? " Isso é esperado com a chave de testes (dados fictícios)." : " Rode o sync de novo para completar o histórico."}
            </div>
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl px-4 py-6 flex-1">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-muted">
          Modelo Poisson/Dixon-Coles com decaimento temporal + Monte Carlo. Probabilidades são estimativas para análise, não
          garantia de resultado. Dados: {db.mode === "csv" ? "resultados football-data.co.uk, escudos API Futebol" : "API Futebol"}
          {db.updatedAt ? ` · atualizado ${new Date(db.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}.
        </footer>
      </body>
    </html>
  );
}
