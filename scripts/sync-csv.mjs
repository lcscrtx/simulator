// Atualiza os resultados reais do Brasileirão (football-data.co.uk). Uso: npm run sync:csv
// O arquivo é atualizado pelo site algumas vezes por semana; 1 download por dia basta.
// --soft: não falha (usado no build da Vercel; sem o arquivo o app cai para a outra fonte de dados).
import fs from "node:fs";

const URL = "https://www.football-data.co.uk/new/BRA.csv";
const OUT = "data/external/BRA.csv";
const fail = (msg) => {
  console.error(msg);
  process.exit(process.argv.includes("--soft") ? 0 : 1);
};

const res = await fetch(URL).catch((e) => fail(`Falha ao baixar ${URL}: ${e.message}`));
if (!res.ok) fail(`Falha ao baixar ${URL}: ${res.status}`);
const text = await res.text();
const lines = text.trim().split(/\r?\n/);
if (!lines[0].includes("HG") || lines.length < 100) fail("Arquivo inesperado; mantendo o anterior.");
const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").trim().split(/\r?\n/).length : 0;
fs.mkdirSync("data/external", { recursive: true });
fs.writeFileSync(OUT, text);
const last = lines.at(-1).split(",");
console.log(`${lines.length - 1} jogos (${lines.length - before >= 0 ? "+" : ""}${lines.length - before} novos). Último: ${last[5]} ${last[7]}x${last[8]} ${last[6]} em ${last[3]}.`);
