"use client";

import { useState } from "react";
import type { LiveRow, Picks } from "@/lib/sim";
import type { SimTeam } from "./Simulator";

export type ShareState = { myTeam: number; picks: Picks; scenario: { kind: string; seed: number; horizon: number }; adj: Record<number, number> };

// Estado compacto na URL: ?s=<base64url de JSON>. Só palpites manuais; o cenário é regerado pela semente.
export function encodeState(s: ShareState): string {
  const json = JSON.stringify({ t: s.myTeam, p: Object.entries(s.picks).map(([id, p]) => [Number(id), p.h, p.a]), c: s.scenario, a: s.adj });
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeState(code: string): ShareState | null {
  try {
    const json = decodeURIComponent(escape(atob(code.replace(/-/g, "+").replace(/_/g, "/"))));
    const o = JSON.parse(json);
    const picks: Picks = {};
    for (const [id, h, a] of o.p ?? []) picks[id] = { h, a };
    return { myTeam: o.t, picks, scenario: o.c, adj: o.a ?? {} };
  } catch {
    return null;
  }
}

export default function ShareBar({ state, team, table, teams, headline, detail }: {
  state: ShareState; team: SimTeam; table: LiveRow[]; teams: Map<number, SimTeam>; headline: string; detail: string;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2500); };
  const url = () => `${location.origin}${location.pathname}?s=${encodeState(state)}`;
  const text = () => `${headline}. ${detail} Simule o seu time:`;

  const shareLink = async () => {
    const link = url();
    if (navigator.share) {
      try { await navigator.share({ title: "Simulador do Brasileirão", text: text(), url: link }); return; } catch { /* cancelado */ }
    }
    try { await navigator.clipboard.writeText(`${text()} ${link}`); flash("Link copiado!"); } catch { flash("Não deu para copiar o link."); }
  };

  const [preview, setPreview] = useState<{ file: File; src: string } | null>(null);
  const openImage = async () => {
    const blob = await drawCard({ team, table, teams, headline, detail });
    if (!blob) return flash("Não deu para gerar a imagem.");
    const file = new File([blob], `simulacao-${team.sigla.toLowerCase()}.png`, { type: "image/png" });
    setPreview({ file, src: URL.createObjectURL(blob) });
  };
  const closePreview = () => { if (preview) URL.revokeObjectURL(preview.src); setPreview(null); };
  const canShareFile = preview != null && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [preview.file] });

  return (
    <div className="card px-3 py-2 flex flex-wrap items-center gap-2">
      <span className="text-sm">📣 <b>Mostre sua simulação</b> <span className="text-muted text-xs">quem abrir o link vê exatamente os seus palpites</span></span>
      <span className="ml-auto flex items-center gap-1.5 text-xs">
        {msg && <span className="text-accent">{msg}</span>}
        <button onClick={shareLink} className="rounded-md border border-line px-2 py-1 hover:border-accent">🔗 Link</button>
        <button onClick={openImage} className="rounded-md bg-accent text-white px-2 py-1">🖼️ Imagem</button>
      </span>
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4" onClick={closePreview}>
          <div className="card p-3 space-y-3 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.src} alt={`Card da simulação do ${team.name}`} className="w-full rounded-lg" />
            <div className="flex gap-2 text-sm">
              {canShareFile && (
                <button className="flex-1 rounded-md bg-accent text-white py-2"
                  onClick={async () => { try { await navigator.share({ files: [preview.file], text: `${text()} ${url()}` }); } catch { /* cancelado */ } }}>
                  Compartilhar
                </button>
              )}
              <a href={preview.src} download={preview.file.name} className="flex-1 rounded-md border border-line py-2 text-center">Baixar</a>
              <button className="rounded-md border border-line px-3" onClick={closePreview}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Card 1080×1350 (formato de post) com a manchete e a tabela projetada em volta do meu time. */
async function drawCard({ team, table, teams, headline, detail }: { team: SimTeam; table: LiveRow[]; teams: Map<number, SimTeam>; headline: string; detail: string }) {
  const W = 1080, H = 1350;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  if (!g) return null;
  const font = (w: number, s: number) => `${w} ${s}px system-ui, -apple-system, Segoe UI, sans-serif`;
  g.fillStyle = "#0d1310"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#34c27a"; g.fillRect(0, 0, W, 12);

  // O CDN dos escudos pode não liberar CORS; sem escudo o título ocupa o espaço dele
  const crest = await loadImage(team.escudo);
  let tx = 72;
  if (crest) { try { g.drawImage(crest, 72, 80, 120, 120); tx = 220; } catch { /* segue sem escudo */ } }
  g.fillStyle = "#93a099"; g.font = font(500, 34); g.fillText("SIMULADOR DO BRASILEIRÃO", tx, 120);
  g.fillStyle = "#e8eee9"; g.font = font(800, 64); g.fillText(team.name, tx, 190);

  g.fillStyle = "#e8eee9"; g.font = font(800, 58);
  wrap(g, headline, 72, 310, W - 144, 70);
  g.fillStyle = "#93a099"; g.font = font(400, 34);
  wrap(g, detail, 72, 470, W - 144, 46);

  // tabela: até 10 linhas em volta do meu time
  const idx = table.findIndex((r) => r.id === team.id);
  const start = Math.max(0, Math.min(table.length - 10, idx - 4));
  const rows = table.slice(start, start + 10);
  let y = 650;
  g.font = font(500, 28); g.fillStyle = "#93a099";
  g.fillText("Classificação final projetada", 72, y - 24);
  for (const [i, r] of rows.entries()) {
    const pos = start + i + 1, mine = r.id === team.id;
    const z = pos <= 6 ? "#1d4ed8" : pos <= 12 ? "#16a34a" : pos > table.length - 4 ? "#dc2626" : null;
    if (mine) { g.fillStyle = "#1c3a2a"; g.fillRect(56, y, W - 112, 56); }
    if (z) { g.fillStyle = z; g.fillRect(56, y, 8, 56); }
    g.fillStyle = mine ? "#e8eee9" : "#c5cec8"; g.font = font(mine ? 700 : 500, 36);
    g.fillText(`${pos}º`, 84, y + 40);
    g.fillText(teams.get(r.id)?.name ?? "", 170, y + 40);
    g.textAlign = "right"; g.fillText(`${r.pts} pts`, W - 84, y + 40); g.textAlign = "left";
    y += 58;
  }
  g.fillStyle = "#93a099"; g.font = font(400, 26);
  g.fillText("Probabilidades estimadas por modelo estatístico · simule o seu time também", 72, H - 60);
  return new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  let line = "";
  for (const word of text.split(" ")) {
    const t = line ? `${line} ${word}` : word;
    if (g.measureText(t).width > max && line) { g.fillText(line, x, y); line = word; y += lh; } else line = t;
  }
  if (line) g.fillText(line, x, y);
}
