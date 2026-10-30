# Simulador do Futebol Brasileiro

Probabilidades, projeções de tabela e dados de partidas para Brasileirão, Copa do Brasil e Libertadores.

## Rodar

```bash
cp .env.example .env.local   # coloque sua chave da API Futebol
npm install
npm run sync                 # baixa dados para data/cache (respeita o limite diário)
npm run dev
```

Chave `test_` = dados fictícios e sem consumir o plano. Troque por `live_` para dados reais.

## Como funciona

- `scripts/sync.mjs`: único ponto que chama a API. Cache em disco com TTL por recurso e teto diário
  (`API_FUTEBOL_DAILY_BUDGET`, padrão 90). Se o limite acabar, o próximo sync continua de onde parou.
- `src/lib/data.ts`: lê o cache e normaliza times, partidas, jogos futuros, escalações e copas.
- `src/lib/model.ts`: força de ataque/defesa por time (Poisson com decaimento temporal de 300 dias),
  placares via Dixon-Coles, Monte Carlo da temporada (10 mil simulações) e de mata-mata, e o peso
  heurístico de desfalques para o modo "e se".
- Páginas: tabela + projeção (`/`), rodadas, partida (`/partida/[id]`), copas e simulador de confronto.

### Orçamento de requisições (plano com 100/dia)

| Recurso | Custo | Frequência |
| --- | --- | --- |
| Histórico de cada time | 20 | semanal |
| Rodadas futuras | ~20 | 1ª vez; depois só as próximas |
| Detalhes de partidas | ~10 por rodada | nunca re-buscados |
| Copas (fases abertas) | poucas | a cada 12h |

## Qualidade do modelo

```bash
npm run backtest   # prevê 2024–2026 jogo a jogo só com dados anteriores e compara com o resultado e com as odds
npm test           # testes da lógica do simulador (tabela, cenários, rivais, desempate, Monte Carlo)
```

Dados do backtest: `data/external/BRA.csv` (football-data.co.uk, resultados + odds de fechamento do Brasileirão).
Resultado atual (1.079 jogos): log loss 1,0095 (mercado 0,9867; só mando de campo 1,0495), 50,9% de acerto (mercado 52,7%).

## Fontes de dados

O app escolhe sozinho (ou force com `DATA_SOURCE=api|csv`):

1. **API Futebol com chave `live_`**: calendário, escalações, estatísticas, copas.
2. **CSV do football-data.co.uk** (padrão sem chave live): resultados reais do Brasileirão. Atualize com `npm run sync:csv`.
   Sem calendário: os jogos restantes são os confrontos que faltam e as rodadas são estimadas. Escudos vêm da API.
3. **API sandbox (`test_`)**: dados fictícios, só para desenvolvimento.
