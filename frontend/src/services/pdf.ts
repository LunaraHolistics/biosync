// services/pdf.ts

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { PlanoTerapeutico } from "../types/planoTerapeutico";

const PDF_CANVAS_SCALE = 2;
const MAX_CHARS_POR_BLOCO = 2400;
const MARGEM_PDF = 20;
const ALTURA_RODAPE = 40;

// 🔥 NOVO: Tipo para evolução de itens no PDF
export type ItemScoreEvolucao = {
  item: string;
  categoria: string;
  score_atual: number;
  score_anterior: number | null;
  delta: number;
  trend: 'melhorou' | 'piorou' | 'estavel' | 'novo';
  impacto: string;
};

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
      impacto_fitness?: {
        performance?: string;
        hipertrofia?: string;
        emagrecimento?: string;
        recuperacao?: string;
        humor?: string;
      };
    }[];
  };
  plano_terapeutico?: PlanoTerapeutico;
  frequencia_lunara: string;
  justificativa: string;
  comparacao?: unknown;
  relatorio_original_html?: string;
  filtros_aplicados?: string[];
  // 🔥 NOVO: Scores por item com evolução para tabela no PDF
  item_scores?: ItemScoreEvolucao[];
};

function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR").format(d);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// 🔥 Divide textos longos em pedaços que cabem em um bloco PDF
function dividirTexto(texto: string, maxChars: number): string[] {
  if (texto.length <= maxChars) return [texto];
  const pedacos: string[] = [];
  let resto = texto;
  while (resto.length > 0) {
    if (resto.length <= maxChars) {
      pedacos.push(resto);
      break;
    }
    let corte = resto.lastIndexOf("\n", maxChars);
    if (corte <= maxChars * 0.3) {
      corte = resto.lastIndexOf(" ", maxChars);
    }
    if (corte <= maxChars * 0.3) corte = maxChars;
    pedacos.push(resto.substring(0, corte));
    resto = resto.substring(corte).trimStart();
  }
  return pedacos;
}

// 🔥 Cria bloco HTML com estilos seguros para PDF (page-break-inside: avoid)
function criarBlocoHTML(html: string, comBordaInferior = false): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width: 694px;
    padding: 16px 20px;
    background: #ffffff;
    border-radius: 6px;
    font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
    color: #111111;
    font-size: 11px;
    line-height: 15px;
    margin-bottom: 12px;
    ${comBordaInferior ? "border-bottom: 1px solid #e5e7eb;" : ""}
    page-break-inside: avoid;
    break-inside: avoid;
  `;
  el.innerHTML = html;
  return el;
}

async function renderizarBlocoParaCanvas(el: HTMLElement, scale: number) {
  return html2canvas(el, {
    scale,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    scrollY: -window.scrollY,
  });
}

// 🔥 Lógica robusta de adição de bloco ao PDF com verificação de espaço
function adicionarBlocoAoPDF(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  currentY: number,
  pageWidth: number,
  pageHeight: number
): number {
  const marginX = MARGEM_PDF;
  const maxY = pageHeight - ALTURA_RODAPE;
  const imgData = canvas.toDataURL("image/png");
  const imgWidth = pageWidth - marginX * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  if (currentY + imgHeight > maxY) {
    pdf.addPage();
    currentY = MARGEM_PDF;
  }

  pdf.addImage(imgData, "PNG", marginX, currentY, imgWidth, imgHeight);
  return currentY + imgHeight + 8;
}

function extrairComparativoHTML(comparacao: unknown): string {
  if (!comparacao || typeof comparacao !== "object") return "";
  const c = comparacao as Record<string, unknown>;
  const secoes: { titulo: string; cor: string; itens: any[] }[] = [
    { titulo: "🟢 Melhoraram", cor: "#16a34a", itens: Array.isArray(c.melhoraram) ? c.melhoraram : [] },
    { titulo: "🔴 Pioraram", cor: "#dc2626", itens: Array.isArray(c.pioraram) ? c.pioraram : [] },
    { titulo: "🟡 Novos Problemas", cor: "#ca8a04", itens: Array.isArray(c.novos_problemas) ? c.novos_problemas : [] },
    { titulo: "⚪ Normalizados", cor: "#6b7280", itens: Array.isArray(c.normalizados) ? c.normalizados : [] },
  ];
  const total = secoes.reduce((s, sec) => s + sec.itens.length, 0);
  if (total === 0) return "";

  const partes: string[] = [`<div style="font-weight:900;margin-bottom:10px;font-size:12px">Evolução entre exames (${total} mudanças)</div>`];
  for (const secao of secoes) {
    if (secao.itens.length === 0) continue;
    const linhas = secao.itens.slice(0, 10).map((item: any) => `
      <div style="margin-bottom:4px;font-size:10px">
        <b>${escapeHtml(item.item || "—")}</b>
        <span style="color:${secao.cor}"> ${escapeHtml(item.evolucao || "")}</span>
        <span style="font-size:9px;opacity:0.7">
          ${item.antes ? escapeHtml(String(item.antes)) : "—"} → ${item.depois ? escapeHtml(String(item.depois)) : "—"}
          ${item.variacao !== undefined ? ` | Δ${item.variacao}` : ""}
        </span>
      </div>
    `).join("");
    partes.push(`
      <div style="margin-bottom:10px;padding:8px;background:#f9fafb;border-radius:4px">
        <div style="font-weight:700;color:${secao.cor};margin-bottom:4px;font-size:11px">
          ${secao.titulo} (${secao.itens.length})
        </div>
        ${linhas}
      </div>
    `);
  }
  return partes.join("");
}

// =======================================================================
// 🔥 NOVA FUNÇÃO: Gerar tabela de evolução por item para o PDF
// =======================================================================
function gerarTabelaEvolucao(itemScores: ItemScoreEvolucao[]): string {
  if (!itemScores || itemScores.length === 0) return '';

  // Ordena: mais impactantes primeiro (maior |delta|), depois alfabético
  const ordenados = [...itemScores].sort((a, b) => {
    if (Math.abs(b.delta) !== Math.abs(a.delta)) {
      return Math.abs(b.delta) - Math.abs(a.delta);
    }
    return a.item.localeCompare(b.item, 'pt-BR');
  }).slice(0, 15); // Limita a 15 itens para não poluir

  const linhas = ordenados.map(item => {
    const icon = item.trend === 'melhorou' ? '🟢' : 
                 item.trend === 'piorou' ? '🔴' : 
                 item.trend === 'novo' ? '🆕' : '🟡';
    
    const deltaStr = item.score_anterior !== null 
      ? `${item.delta >= 0 ? '+' : ''}${item.delta}` 
      : '—';
    
    const scoreAnterior = item.score_anterior !== null 
      ? item.score_anterior 
      : '—';
    
    const corDelta = item.delta >= 0 ? '#16a34a' : '#dc2626';

    return `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 8px 4px; font-size: 10px; font-weight: 600; color: #1e293b; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.item)}</td>
        <td style="padding: 8px 4px; font-size: 10px; text-align: center; color: #475569;">${scoreAnterior}</td>
        <td style="padding: 8px 4px; font-size: 10px; text-align: center; font-weight: 700; color: #0f172a;">${item.score_atual}</td>
        <td style="padding: 8px 4px; font-size: 10px; text-align: center; font-weight: 700; color: ${corDelta};">${deltaStr}</td>
        <td style="padding: 8px 4px; font-size: 10px; text-align: center;">${icon}</td>
      </tr>
    `;
  }).join('');

  // Calcula resumo para badge
  const resumo = {
    melhoraram: ordenados.filter(i => i.trend === 'melhorou').length,
    pioraram: ordenados.filter(i => i.trend === 'piorou').length,
    estaveis: ordenados.filter(i => i.trend === 'estavel').length,
    novos: ordenados.filter(i => i.trend === 'novo').length
  };

  return `
    <div style="margin: 20px 0; page-break-inside: avoid;" data-pdf-section="evolucao">
      <div style="font-size: 13px; font-weight: 800; color: #0f172a; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
        <span>📈</span> Evolução dos Principais Itens
      </div>
      
      <!-- Badge de resumo -->
      <div style="display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
        ${resumo.melhoraram > 0 ? `<span style="background: #dcfce7; color: #166534; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">🟢 ${resumo.melhoraram} melhoraram</span>` : ''}
        ${resumo.estaveis > 0 ? `<span style="background: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">🟡 ${resumo.estaveis} estáveis</span>` : ''}
        ${resumo.pioraram > 0 ? `<span style="background: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">🔴 ${resumo.pioraram} pioraram</span>` : ''}
        ${resumo.novos > 0 ? `<span style="background: #dbeafe; color: #1e40af; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">🆕 ${resumo.novos} novos</span>` : ''}
      </div>
      
      <div style="font-size: 9px; color: #64748b; margin-bottom: 8px; font-style: italic;">
        Comparativo com exame anterior • 🟢 Melhorou (≥10 pts) • 🟡 Estável (±9 pts) • 🔴 Piorou (≤-10 pts) • 🆕 Novo
      </div>
      
      <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
        <thead>
          <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
            <th style="padding: 8px 4px; text-align: left; font-weight: 700; color: #334155; width: 45%;">Item</th>
            <th style="padding: 8px 4px; text-align: center; font-weight: 700; color: #334155; width: 12%;">Anterior</th>
            <th style="padding: 8px 4px; text-align: center; font-weight: 700; color: #334155; width: 12%;">Atual</th>
            <th style="padding: 8px 4px; text-align: center; font-weight: 700; color: #334155; width: 10%;">Δ</th>
            <th style="padding: 8px 4px; text-align: center; font-weight: 700; color: #334155; width: 10%;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${linhas}
        </tbody>
      </table>
    </div>
  `;
}

export async function gerarRelatorioPDF(data: RelatorioData) {
  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed;
    left: -9999px;
    top: 0;
    width: 794px;
    padding: 24px;
    background: #ffffff;
    box-sizing: border-box;
  `;

  const blocks: HTMLElement[] = [];

  // =======================================================================
  // 1. CABEÇALHO (com filtros aplicados, se houver)
  // =======================================================================
  const filtrosHTML = data.filtros_aplicados?.length
    ? `<div style="font-size:10px;color:#0ea5e9;margin-top:4px">
        🔍 Filtro: ${data.filtros_aplicados.map(f => f === 'emotional' ? 'Emocional' : f).join(', ')}
      </div>`
    : '';

  blocks.push(
    criarBlocoHTML(`
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <div style="font-size:18px;font-weight:900;color:#0f172a">BioSync Report</div>
          <div style="font-size:11px;color:#64748b">Relatório Terapêutico Integrativo</div>
        </div>
        <div style="text-align:right;font-size:10px;color:#64748b">
          <b>${escapeHtml(data.clientName)}</b><br/>
          ${formatDate(data.createdAt)}
        </div>
      </div>
      ${filtrosHTML}
    `, true)
  );

  // =======================================================================
  // 2. INTERPRETAÇÃO (fatiada se longa)
  // =======================================================================
  if (data.interpretacao) {
    const pedacos = dividirTexto(data.interpretacao, MAX_CHARS_POR_BLOCO);
    for (let i = 0; i < pedacos.length; i++) {
      const titulo = i === 0 ? "📋 Interpretação" : "Interpretação (cont.)";
      blocks.push(
        criarBlocoHTML(`
          <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:6px">${titulo}</div>
          <div style="white-space:pre-wrap;color:#334155;font-size:11px;line-height:16px">${escapeHtml(pedacos[i])}</div>
        `, i < pedacos.length - 1)
      );
    }
  }

  // =======================================================================
  // 3. PONTOS CRÍTICOS
  // =======================================================================
  if (data.pontos_criticos.length > 0) {
    const listaHTML = data.pontos_criticos
      .map(p => `<li style="margin-bottom:3px;font-size:11px;color:#334155">${escapeHtml(p)}</li>`)
      .join("");
    blocks.push(
      criarBlocoHTML(`
        <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:6px">⚠️ Pontos Críticos</div>
        <ul style="margin:0;padding-left:18px;list-style-type:disc">${listaHTML}</ul>
      `, true)
    );
  }

  // =======================================================================
  // 🔥 NOVO: TABELA DE EVOLUÇÃO POR ITEM (se houver item_scores)
  // =======================================================================
  if (data.item_scores && data.item_scores.length > 0) {
    const tabelaHTML = gerarTabelaEvolucao(data.item_scores);
    if (tabelaHTML) {
      blocks.push(criarBlocoHTML(tabelaHTML, true));
    }
  }

  // =======================================================================
  // 4. COMPARATIVO (se existir)
  // =======================================================================
  const comparativoHTML = extrairComparativoHTML(data.comparacao);
  if (comparativoHTML) {
    blocks.push(criarBlocoHTML(comparativoHTML, true));
  }

  // =======================================================================
  // 5. MAPA TÉCNICO + IMPACTO FITNESS (agrupado por sistema, paginado)
  // =======================================================================
  if (data.diagnostico?.problemas && data.diagnostico.problemas.length > 0) {
    const grupos: Record<string, typeof data.diagnostico.problemas> = {};
    for (const item of data.diagnostico.problemas) {
      const sys = item.sistema || "Geral";
      if (!grupos[sys]) grupos[sys] = [];
      grupos[sys].push(item);
    }

    const categoriasOrdenadas = Object.entries(grupos).sort((a, b) => b[1].length - a[1].length);
    let isFirstBlock = true;
    const ITENS_POR_BLOCO = 10;

    for (const [sistema, itens] of categoriasOrdenadas) {
      for (let i = 0; i < itens.length; i += ITENS_POR_BLOCO) {
        const chunk = itens.slice(i, i + ITENS_POR_BLOCO);
        const impactosUnicos = [...new Set(chunk.map(it => it.impacto).filter(Boolean))];
        const sintomasStr = impactosUnicos.length > 0
          ? `<div style="font-size:10px;color:#64748b;margin:4px 0 6px 0"><b>Sintomas:</b> ${impactosUnicos.slice(0, 3).join("; ")}${impactosUnicos.length > 3 ? "..." : ""}</div>`
          : "";

        const fitnessMap: Record<string, Set<string>> = {};
        for (const it of chunk) {
          if (!it.impacto_fitness) continue;
          for (const [k, v] of Object.entries(it.impacto_fitness)) {
            if (!fitnessMap[k]) fitnessMap[k] = new Set();
            fitnessMap[k].add(String(v));
          }
        }
        const fitnessTags = Object.entries(fitnessMap).map(([k, v]) => {
          const emoji = { performance: '💪', hipertrofia: '🏋️', emagrecimento: '🔥', recuperacao: '🩹', humor: '🧠' }[k] || '📊';
          return `<span style="background:#f0f9ff;color:#0284c7;padding:2px 6px;border-radius:4px;font-size:9px;margin-right:4px;display:inline-block">${emoji} ${k}: ${[...v].slice(0, 2).join(", ")}${v.size > 2 ? "..." : ""}</span>`;
        }).join("");
        const fitnessStr = fitnessTags ? `<div style="margin-top:4px">${fitnessTags}</div>` : "";

        const nomesItens = [...new Set(chunk.map(it => it.item))].join(", ");
        const htmlItens = `
          <div style="font-weight:800;color:#0f172a;font-size:11px;margin-bottom:3px">${escapeHtml(sistema)}</div>
          <div style="font-size:10px;color:#475569;margin-bottom:4px">${escapeHtml(nomesItens)}</div>
          ${sintomasStr}
          ${fitnessStr}
        `;

        const titulo = isFirstBlock
          ? `<div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:8px">🔍 Mapa Técnico e Impacto Fitness</div>`
          : `<div style="font-size:10px;color:#64748b;margin-bottom:8px;font-style:italic">Mapa Técnico (continuação)</div>`;

        blocks.push(criarBlocoHTML(`${titulo}${htmlItens}`, true));
        isFirstBlock = false;
      }
    }
  }

  // =======================================================================
  // 6. PLANO TERAPÊUTICO (paginado: 4 terapias por bloco)
  // =======================================================================
  if (data.plano_terapeutico?.terapias?.length) {
    const terapias = data.plano_terapeutico.terapias;
    const TERAPIAS_POR_BLOCO = 4;

    for (let i = 0; i < terapias.length; i += TERAPIAS_POR_BLOCO) {
      const chunk = terapias.slice(i, i + TERAPIAS_POR_BLOCO);
      const htmlTerapias = chunk.map((t) => `
        <div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px dashed #e2e8f0">
          <div style="font-weight:700;color:#0f172a;font-size:11px">${escapeHtml(t.nome)}</div>
          <div style="font-size:10px;color:#0284c7;margin:2px 0"><b>${escapeHtml(t.frequencia || "")}</b></div>
          <div style="color:#475569;font-size:10px">${escapeHtml(t.descricao || "")}</div>
          ${t.justificativa ? `<div style="font-size:9px;color:#64748b;margin-top:3px"><b>Por quê:</b> ${escapeHtml(t.justificativa)}</div>` : ""}
        </div>
      `).join("");

      const titulo = i === 0
        ? `<div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:8px">🌿 Plano Terapêutico</div>`
        : `<div style="font-size:10px;color:#64748b;margin-bottom:8px;font-style:italic">Plano Terapêutico (cont.)</div>`;

      blocks.push(criarBlocoHTML(`${titulo}${htmlTerapias}`, i < terapias.length - TERAPIAS_POR_BLOCO));
    }
  }

  // =======================================================================
  // 7. FREQUÊNCIA SOLFEGGIO + JUSTIFICATIVA
  // =======================================================================
  const frequenciaTexto = data.frequencia_lunara && !/^[\s—\-–]+$/.test(data.frequencia_lunara)
    ? data.frequencia_lunara
    : "Recomendação: Utilizar frequências Solfeggio (ex: 432Hz harmonização, 528Hz reparação) durante a sessão.";

  let htmlFrequenciaEJustificativa = `
    <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:6px">🎵 Frequência para Sessão</div>
    <div style="color:#334155;margin-bottom:12px;background:#f8fafc;padding:10px;border-radius:6px;border-left:4px solid #8b5cf6;font-size:11px">
      ${escapeHtml(frequenciaTexto)}
    </div>
  `;

  if (data.justificativa && !/^[\s—\-–]+$/.test(data.justificativa)) {
    htmlFrequenciaEJustificativa += `
      <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:6px">📝 Justificativa</div>
      <div style="color:#475569;font-size:11px;white-space:pre-line">${escapeHtml(data.justificativa)}</div>
    `;
  }

  blocks.push(criarBlocoHTML(htmlFrequenciaEJustificativa));

  // =======================================================================
  // 8. RODAPÉ
  // =======================================================================
  blocks.push(
    criarBlocoHTML(`
      <div style="text-align:center;font-size:9px;color:#94a3b8;padding-top:8px;border-top:1px solid #e2e8f0">
        Gerado por BioSync • Saúde Integrativa • ${new Date().getFullYear()}
      </div>
    `)
  );

  // =======================================================================
  // RENDERIZAÇÃO FINAL
  // =======================================================================
  blocks.forEach((b) => container.appendChild(b));
  document.body.appendChild(container);

  try {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    let currentY = MARGEM_PDF;

    for (const block of blocks) {
      const canvas = await renderizarBlocoParaCanvas(block, PDF_CANVAS_SCALE);
      currentY = adicionarBlocoAoPDF(pdf, canvas, currentY, pageWidth, pageHeight);
    }

    const safeFilename = data.clientName.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
    pdf.save(`biosync-${safeFilename || "relatorio"}-${formatDate(data.createdAt).replace(/\//g, "-")}.pdf`);

  } catch (error) {
    console.error("❌ Erro ao gerar PDF:", error);
    alert("Erro ao gerar o PDF. Tente novamente ou contate o suporte.");
  } finally {
    container.remove();
  }
}