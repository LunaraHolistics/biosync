import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { PlanoTerapeutico } from "../types/planoTerapeutico";

const PDF_CANVAS_SCALE_DEFAULT = 2.5;

export type RelatorioData = {
  clientName: string;
  createdAt: string | Date;
  interpretacao: string;
  pontos_criticos: string[];
  diagnostico?: {
    problemas: {
      sistema: string;
      item: string;
      status: string;
      impacto: string;
      score?: number;
    }[];
  };
  comparacao?: {
    melhoraram: {
      sistema: string;
      item: string;
      antes: string | null;
      depois: string | null;
      evolucao: "melhora" | "piora" | "novo" | "normalizado";
    }[];
    pioraram: {
      sistema: string;
      item: string;
      antes: string | null;
      depois: string | null;
      evolucao: "melhora" | "piora" | "novo" | "normalizado";
    }[];
    novos_problemas: {
      sistema: string;
      item: string;
      antes: string | null;
      depois: string | null;
      evolucao: "melhora" | "piora" | "novo" | "normalizado";
    }[];
    normalizados: {
      sistema: string;
      item: string;
      antes: string | null;
      depois: string | null;
      evolucao: "melhora" | "piora" | "novo" | "normalizado";
    }[];
  };

  itens_analisados?: { nome: string; valor: string }[];

  plano_terapeutico?: PlanoTerapeutico;

  frequencia_lunara: string;
  justificativa: string;
};

function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function li(items: string[]): string {
  if (!items?.length) return `<li style="margin:0;color:#9ca3af">—</li>`;
  return items
    .map((x) => `<li style="margin:0 0 6px 0">${escapeHtml(x)}</li>`)
    .join("");
}

function evolucaoList(
  items: { sistema: string; item: string; antes: string | null; depois: string | null }[],
): string {
  if (!items?.length) return `<li style="margin:0;color:#9ca3af">—</li>`;
  return items
    .map(
      (x) =>
        `<li style="margin:0 0 6px 0"><b>${escapeHtml(x.sistema)}:</b> ${escapeHtml(x.item)} (${escapeHtml(
          x.antes ?? "—",
        )} → ${escapeHtml(x.depois ?? "—")})</li>`,
    )
    .join("");
}

function severidadePorScore(score?: number): "leve" | "moderado" | "severo" | null {
  if (typeof score !== "number") return null;
  if (score <= 20) return "leve";
  if (score <= 50) return "moderado";
  return "severo";
}

function badgeSeveridade(score?: number): string {
  const sev = severidadePorScore(score);
  if (!sev) return "";
  const label = sev === "leve" ? "Leve" : sev === "moderado" ? "Moderado" : "Severo";
  const bg = sev === "leve" ? "#f3f4f6" : sev === "moderado" ? "#fffbeb" : "#fef2f2";
  const border = sev === "leve" ? "#e5e7eb" : sev === "moderado" ? "#fde68a" : "#fecaca";
  const color = sev === "leve" ? "#374151" : sev === "moderado" ? "#92400e" : "#991b1b";
  const scoreText = typeof score === "number" ? `${Math.round(score)}%` : "";
  return `<span style="display:inline-block;margin-left:10px;padding:2px 9px;border-radius:999px;border:1px solid ${border};background:${bg};color:${color};font-weight:900;font-size:11px;white-space:nowrap">Severidade: ${label}${scoreText ? ` (${scoreText})` : ""}</span>`;
}

function ordenarProblemasPorScore<T extends { score?: number }>(items: T[]): T[] {
  if (!items?.length) return items;
  const allHaveScore = items.every((p) => typeof p.score === "number");
  if (!allHaveScore) return items;
  return [...items].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
}

function splitParagraphs(text: string): string[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const base = raw
    .split(/\n\s*\n+/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const p of base) {
    if (p.length <= 800) {
      out.push(p);
      continue;
    }
    // Fallback: split long paragraphs by sentences.
    const sentences = p.split(/(?<=[.!?])\s+/g).map((s) => s.trim()).filter(Boolean);
    if (!sentences.length) {
      out.push(p);
      continue;
    }
    // Re-pack into ~400-600 char chunks to avoid gigantic blocks.
    let buf = "";
    for (const s of sentences) {
      const next = buf ? `${buf} ${s}` : s;
      if (next.length > 600 && buf) {
        out.push(buf);
        buf = s;
      } else {
        buf = next;
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (!items?.length) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    out.push(items.slice(i, i + chunkSize));
  }
  return out;
}

function criarBlocoHTML(html: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "694px";
  el.style.boxSizing = "border-box";
  el.style.borderRadius = "16px";
  el.style.padding = "16px";
  el.style.background = "#ffffff";
  el.style.border = "1px solid #e5e7eb";
  el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.05)";
  el.style.color = "#111827";
  el.style.fontFamily = "Arial, sans-serif";
  el.innerHTML = html;
  return el;
}

async function renderizarBlocoParaCanvas(
  el: HTMLElement,
  scale: number,
): Promise<HTMLCanvasElement> {
  return await html2canvas(el, {
    scale,
    useCORS: true,
    backgroundColor: "#ffffff",
  });
}

function adicionarBlocoAoPDF(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  currentY: number,
  pageWidth: number,
  pageHeight: number,
): number {
  const marginX = 20;
  const topBottomLimit = 40;
  const maxY = pageHeight - topBottomLimit;

  const imgData = canvas.toDataURL("image/png");
  const imgWidth = pageWidth - marginX * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  if (currentY + imgHeight > maxY) {
    pdf.addPage();
    currentY = 20;
  }

  pdf.addImage(imgData, "PNG", marginX, currentY, imgWidth, imgHeight);
  return currentY + imgHeight + 12;
}

export async function gerarRelatorioPDF(data: RelatorioData): Promise<void> {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "794px";
  container.style.background = "#ffffff";
  container.style.color = "#111827";
  container.style.fontFamily = "Arial, sans-serif";
  container.style.padding = "40px";
  container.style.boxSizing = "border-box";

  const createdAt = formatDate(data.createdAt);
  const fileSafeName = (data.clientName || "cliente")
    .trim()
    .replaceAll(/[/\\:*?"<>|]+/g, "-")
    .slice(0, 80);

  const resumoCaso = (() => {
    const problemas = data.diagnostico?.problemas ?? [];
    if (!problemas.length) return null;

    const scores = problemas.map((p) => (typeof p.score === "number" ? p.score : 0));
    const severos = scores.filter((s) => s > 50).length;
    const moderados = scores.filter((s) => s > 20 && s <= 50).length;
    const leves = scores.filter((s) => s <= 20).length;

    return { total: problemas.length, severos, moderados, leves };
  })();

  const blocks: HTMLElement[] = [];

  // 1. Header
  blocks.push(
    criarBlocoHTML(`
      <div style="display:flex;align-items:center;gap:16px">
        <div style="width:78px;display:flex;align-items:center;justify-content:center">
          <img src="/logo.jpeg" style="width:72px;height:72px;object-fit:cover;border-radius:16px;border:1px solid #e5e7eb;background:#fff" />
        </div>
        <div style="flex:1">
          <div style="font-size:22px;font-weight:900;letter-spacing:0.2px;color:#111827;line-height:1.2">
            Relatório Terapêutico Integrativo
          </div>
          <div style="font-size:12px;color:#6b7280;margin-top:6px">
            Análise energética personalizada
          </div>
          <div style="margin-top:12px;font-size:13px;color:#374151;line-height:1.5">
            <b>Cliente:</b> ${escapeHtml(data.clientName)} &nbsp;•&nbsp;
            <b>Data:</b> ${escapeHtml(createdAt)}
          </div>
        </div>
      </div>
    `),
  );

  // 2. Itens analisados
  if (data.itens_analisados?.length) {
    blocks.push(
      criarBlocoHTML(`
        <div style="font-size:12px;font-weight:900;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase">Itens analisados</div>
        <table style="width:100%;margin-top:10px;font-size:12px;border-collapse:collapse">
          ${data.itens_analisados
            .map(
              (i) => `
              <tr>
                <td style="padding:6px 0;border-bottom:1px solid #eee">${escapeHtml(i.nome)}</td>
                <td style="padding:6px 0;text-align:right;border-bottom:1px solid #eee">${escapeHtml(i.valor)}</td>
              </tr>
            `,
            )
            .join("")}
        </table>
      `),
    );
  }

  // 3. Interpretação (quebrada)
  blocks.push(
    criarBlocoHTML(`
      <div style="font-size:12px;font-weight:900;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase">Interpretação</div>
    `),
  );
  const interpretacaoParts = splitParagraphs(data.interpretacao || "");
  if (!interpretacaoParts.length) {
    blocks.push(criarBlocoHTML(`<div style="font-size:14px;line-height:1.85;color:#111827">—</div>`));
  } else {
    for (const p of interpretacaoParts) {
      blocks.push(criarBlocoHTML(`<div style="font-size:14px;line-height:1.85;color:#111827">${escapeHtml(p)}</div>`));
    }
  }

  // 4. Visão geral
  if (data.diagnostico?.problemas?.length) {
    blocks.push(
      criarBlocoHTML(`
        <div style="font-size:12px;font-weight:900;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase">Visão geral do equilíbrio</div>
        <div style="margin-top:10px;font-size:13px;line-height:1.8;color:#374151">
          Foram identificados <b>${data.diagnostico.problemas.length}</b> pontos de desequilíbrio que podem impactar seu bem-estar físico, emocional e energético.
        </div>
      `),
    );
  }

  // 5. Problemas (um card por item)
  if (data.diagnostico?.problemas?.length) {
    const problemas = ordenarProblemasPorScore(data.diagnostico.problemas);
    blocks.push(
      criarBlocoHTML(`
        <div style="font-size:12px;font-weight:900;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase">Tópicos identificados</div>
      `),
    );

    for (const p of problemas) {
      const isSevero = typeof p.score === "number" && p.score > 50;
      blocks.push(
        criarBlocoHTML(`
          <div style="border:1px solid ${isSevero ? "#fecaca" : "#e5e7eb"};border-radius:14px;padding:14px;background:${isSevero ? "#fff7f7" : "#ffffff"};box-shadow:none">
            <div style="font-size:12.5px;line-height:1.65;color:#111827">
              ${
                isSevero
                  ? `<div style="font-size:11px;font-weight:900;color:#991b1b;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:8px">Alta prioridade terapêutica</div>`
                  : ""
              }
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                <div style="font-weight:900;line-height:1.35">
                  ${escapeHtml(p.sistema)} — ${escapeHtml(p.item)}
                </div>
                <div>
                  ${badgeSeveridade(p.score)}
                </div>
              </div>
              <div style="margin-top:6px;color:#374151">
                <b>Condição:</b> ${
                  p.status === "baixo"
                    ? "Em baixa atividade"
                    : p.status === "alto"
                      ? "Em sobrecarga"
                      : "Equilibrado"
                }
              </div>
              <div style="margin-top:8px;color:#374151">
                ${escapeHtml(p.impacto)}
              </div>
            </div>
          </div>
        `),
      );
    }
  }

  // 6. Comparação (grupos separados)
  const hasComparacao =
    !!data.comparacao &&
    (data.comparacao.melhoraram.length ||
      data.comparacao.pioraram.length ||
      data.comparacao.novos_problemas.length ||
      data.comparacao.normalizados.length);

  if (hasComparacao) {
    blocks.push(
      criarBlocoHTML(`
        <div style="font-size:12px;font-weight:900;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase">Evolução entre exames</div>
      `),
    );

    blocks.push(
      criarBlocoHTML(`
        <div style="border:1px solid #bbf7d0;background:#f0fdf4;border-radius:12px;padding:12px;box-shadow:none">
          <div style="font-size:13px;font-weight:900;color:#166534;margin-bottom:6px">🟢 Melhoras observadas</div>
          <ul style="margin:0;padding-left:18px;font-size:12px;color:#14532d;line-height:1.6">
            ${evolucaoList(data.comparacao!.melhoraram)}
          </ul>
        </div>
      `),
    );

    blocks.push(
      criarBlocoHTML(`
        <div style="border:1px solid #fecaca;background:#fef2f2;border-radius:12px;padding:12px;box-shadow:none">
          <div style="font-size:13px;font-weight:900;color:#991b1b;margin-bottom:6px">🔴 Pontos que precisam de atenção</div>
          <ul style="margin:0;padding-left:18px;font-size:12px;color:#7f1d1d;line-height:1.6">
            ${evolucaoList(data.comparacao!.pioraram)}
          </ul>
        </div>
      `),
    );

    blocks.push(
      criarBlocoHTML(`
        <div style="border:1px solid #fde68a;background:#fffbeb;border-radius:12px;padding:12px;box-shadow:none">
          <div style="font-size:13px;font-weight:900;color:#92400e;margin-bottom:6px">🆕 Novos pontos identificados</div>
          <ul style="margin:0;padding-left:18px;font-size:12px;color:#78350f;line-height:1.6">
            ${evolucaoList(data.comparacao!.novos_problemas)}
          </ul>
        </div>
      `),
    );

    blocks.push(
      criarBlocoHTML(`
        <div style="border:1px solid #e5e7eb;background:#f3f4f6;border-radius:12px;padding:12px;box-shadow:none">
          <div style="font-size:13px;font-weight:900;color:#4b5563;margin-bottom:6px">⚪ Áreas reequilibradas</div>
          <ul style="margin:0;padding-left:18px;font-size:12px;color:#374151;line-height:1.6">
            ${evolucaoList(data.comparacao!.normalizados)}
          </ul>
        </div>
      `),
    );
  }

  // 7. Pontos críticos (sub-blocos)
  blocks.push(
    criarBlocoHTML(`
      <div style="font-size:12px;font-weight:900;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase">Pontos críticos</div>
    `),
  );
  const pontos = Array.isArray(data.pontos_criticos) ? data.pontos_criticos : [];
  const chunksPontos = chunkArray(pontos, 8);
  if (!chunksPontos.length) {
    blocks.push(criarBlocoHTML(`<ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7">${li([])}</ul>`));
  } else {
    for (const chunk of chunksPontos) {
      blocks.push(
        criarBlocoHTML(`
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7">
            ${li(chunk)}
          </ul>
        `),
      );
    }
  }

  // 8. Resumo do caso
  if (resumoCaso) {
    blocks.push(
      criarBlocoHTML(`
        <div style="border:1px solid #e5e7eb;background:#f9fafb;border-radius:14px;padding:14px;box-shadow:none">
          <div style="font-size:12px;font-weight:900;color:#111827;letter-spacing:0.06em;text-transform:uppercase">
            Resumo do caso
          </div>
          <div style="margin-top:10px;font-size:13px;line-height:1.8;color:#374151">
            Este exame identificou <b>${resumoCaso.total}</b> pontos de atenção, sendo <b>${resumoCaso.severos}</b> de maior prioridade terapêutica.
            O plano terapêutico foi estruturado para orientar o acompanhamento de forma progressiva.
          </div>
          <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:#374151">
            <span style="padding:4px 10px;border-radius:999px;border:1px solid #e5e7eb;background:#ffffff"><b>Leves:</b> ${resumoCaso.leves}</span>
            <span style="padding:4px 10px;border-radius:999px;border:1px solid #fde68a;background:#fffbeb"><b>Moderados:</b> ${resumoCaso.moderados}</span>
            <span style="padding:4px 10px;border-radius:999px;border:1px solid #fecaca;background:#fef2f2"><b>Severos:</b> ${resumoCaso.severos}</span>
          </div>
        </div>
      `),
    );
  }

  // 9. Plano terapêutico
  const plano = data.plano_terapeutico;
  const tipoLabel =
    plano?.tipo === "semanal"
      ? "Semanal"
      : plano?.tipo === "quinzenal"
        ? "Quinzenal"
        : plano?.tipo === "mensal"
          ? "Mensal"
          : "";
  blocks.push(
    criarBlocoHTML(`
      <div style="font-size:12px;font-weight:900;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase">Plano terapêutico</div>
    `),
  );
  if (plano?.terapias?.length) {
    blocks.push(
      criarBlocoHTML(`
        <div style="border:1px solid #c7d2fe;background:#eef2ff;border-radius:14px;padding:14px;box-shadow:none;margin-bottom:10px">
          <div style="font-weight:900;margin-bottom:6px;color:#3730a3;font-size:13px">Periodicidade sugerida: ${escapeHtml(tipoLabel || "—")}</div>
          <div style="font-size:12px;color:#4b5563;line-height:1.6">Baseada na severidade estimada a partir do diagnóstico e dos pontos críticos.</div>
        </div>
      `),
    );
    for (const item of plano.terapias) {
      blocks.push(
        criarBlocoHTML(`
          <div style="border:1px solid #e5e7eb;background:#ffffff;border-radius:14px;padding:14px;box-shadow:none;margin-bottom:10px">
            <div style="font-weight:900;color:#111827;font-size:14px;margin-bottom:6px">${escapeHtml(item.nome)}</div>
            <div style="font-size:12px;color:#6b7280;margin-bottom:8px"><b>Frequência:</b> ${escapeHtml(item.frequencia || "—")}</div>
            <div style="font-size:13px;color:#374151;line-height:1.7;margin-bottom:8px">${escapeHtml(item.descricao || "—")}</div>
            <div style="font-size:12px;color:#111827;line-height:1.6;padding:10px;background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb">
              <b>Justificativa:</b> ${escapeHtml(item.justificativa || "—")}
            </div>
          </div>
        `),
      );
    }
  } else {
    blocks.push(
      criarBlocoHTML(`
        <div style="border:1px solid #e5e7eb;border-radius:14px;padding:14px;font-size:13px;color:#6b7280">
          Nenhum plano terapêutico estruturado disponível para este relatório.
        </div>
      `),
    );
  }

  // 10. Frequência
  blocks.push(
    criarBlocoHTML(`
      <div style="border:1px solid #d1d5db;border-radius:14px;padding:16px;text-align:center;box-shadow:none;background:#ffffff">
        <div style="font-size:11px;color:#6b7280">
          Frequência recomendada para harmonização energética
        </div>
        <div style="font-size:22px;font-weight:900;letter-spacing:1px;margin-top:4px">
          ${escapeHtml(data.frequencia_lunara || "N/A")}
        </div>
      </div>
    `),
  );

  // 11. Orientação terapêutica (quebrada)
  blocks.push(
    criarBlocoHTML(`
      <div style="font-size:12px;font-weight:900;color:#6b7280;letter-spacing:0.06em;text-transform:uppercase">Orientação terapêutica</div>
    `),
  );
  const orientacaoParts = splitParagraphs(data.justificativa || "");
  if (!orientacaoParts.length) {
    blocks.push(criarBlocoHTML(`<div style="font-size:13px;line-height:1.85;color:#111827">—</div>`));
  } else {
    for (const p of orientacaoParts) {
      blocks.push(criarBlocoHTML(`<div style="font-size:13px;line-height:1.85;color:#111827">${escapeHtml(p)}</div>`));
    }
  }

  // 12. Assinatura profissional
  blocks.push(
    criarBlocoHTML(`
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-end">
        <div>
          <div style="font-size:12px;font-weight:900;color:#111827">Assinatura profissional</div>
          <div style="margin-top:6px;font-size:12px;line-height:1.7;color:#374151">
            Relatório gerado por sistema terapêutico integrativo.<br />
            <span style="color:#6b7280">Este documento não substitui avaliação médica.</span>
          </div>
        </div>
        <div style="text-align:right;font-size:12px;color:#374151">
          <div style="font-weight:900">BioMag</div>
          <div style="color:#6b7280;margin-top:4px">Clínica Premium</div>
        </div>
      </div>
    `),
  );

  for (const b of blocks) {
    b.style.margin = "0 auto 14px auto";
    container.appendChild(b);
  }

  document.body.appendChild(container);

  try {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const scale = blocks.length > 28 ? 2 : PDF_CANVAS_SCALE_DEFAULT;
    let currentY = 20;
    for (const block of blocks) {
      const canvas = await renderizarBlocoParaCanvas(block, scale);
      currentY = adicionarBlocoAoPDF(pdf, canvas, currentY, pageWidth, pageHeight);
    }

    pdf.save(`relatorio-${fileSafeName}.pdf`);
  } finally {
    container.remove();
  }
}