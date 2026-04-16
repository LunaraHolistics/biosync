import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { PlanoTerapeutico } from "../types/planoTerapeutico";

const PDF_CANVAS_SCALE_DEFAULT = 2;
const MAX_CHARS_POR_BLOCO = 2800; // Reduzido levemente para garantir margem de segurança visual

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

// Divide textos longos antes de virarem imagem
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
    if (corte <= maxChars * 0.3) corte = maxChars;
    pedacos.push(resto.substring(0, corte));
    resto = resto.substring(corte).trimStart();
  }
  return pedacos;
}

function criarBlocoHTML(html: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "694px";
  el.style.padding = "20px";
  el.style.background = "#ffffff";
  el.style.borderRadius = "8px";
  el.style.fontFamily = "Arial, sans-serif";
  el.style.color = "#111111";
  el.style.fontSize = "11px";
  el.style.lineHeight = "16px";
  el.innerHTML = html;
  return el;
}

async function renderizarBlocoParaCanvas(el: HTMLElement, scale: number) {
  return html2canvas(el, {
    scale,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });
}

// Lógica limpa: Se o bloco não couber, ele pula de página SEM CORTAR a imagem
function adicionarBlocoAoPDF(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  currentY: number,
  pageWidth: number,
  pageHeight: number
): number {
  const marginX = 20;
  const marginBotton = 50; // Margem de segurança reforçada no rodapé
  const maxY = pageHeight - marginBotton;

  const imgData = canvas.toDataURL("image/png");
  const imgWidth = pageWidth - marginX * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  // Verifica se o bloco INTEIRO cabe na página atual
  if (currentY + imgHeight <= maxY) {
    pdf.addImage(imgData, "PNG", marginX, currentY, imgWidth, imgHeight);
    return currentY + imgHeight + 8;
  }

  // Se não couber, pula para a próxima página
  pdf.addPage();
  currentY = 20;

  // Verificação extrema de segurança: se o bloco for MAIOR que uma página inteira, 
  // ele adiciona do mesmo jeito para não travar o PDF (mas com os blocos quebrados abaixo, isso não deve ocorrer)
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

  const partes: string[] = [`<div style="font-weight:900;margin-bottom:10px">Evolução entre exames (${total} mudanças)</div>`];

  for (const secao of secoes) {
    if (secao.itens.length === 0) continue;
    const linhas = secao.itens.slice(0, 10).map((item: any) => `
      <div style="margin-bottom:4px">
        <b>${escapeHtml(item.item || "—")}</b>
        <span style="color:${secao.cor}"> ${escapeHtml(item.evolucao || "")}</span>
        <span style="font-size:10px;opacity:0.7">
          ${item.antes ? escapeHtml(String(item.antes)) : "—"} → ${item.depois ? escapeHtml(String(item.depois)) : "—"}
          ${item.variacao !== undefined ? ` | Δ${item.variacao}` : ""}
        </span>
      </div>
    `).join("");

    partes.push(`
      <div style="margin-bottom:10px">
        <div style="font-weight:700;color:${secao.cor};margin-bottom:4px">
          ${secao.titulo} (${secao.itens.length})
        </div>
        ${linhas}
      </div>
    `);
  }

  return partes.join("");
}

export async function gerarRelatorioPDF(data: RelatorioData) {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.width = "794px";
  container.style.padding = "30px";
  container.style.background = "#ffffff";

  const blocks: HTMLElement[] = [];

  // 1. CABEÇALHO
  blocks.push(
    criarBlocoHTML(`
      <div style="font-size:20px;font-weight:900;color:#111;margin-bottom:8px">
        Relatório Terapêutico - BioSync Saúde Integrativa
      </div>
      <div style="font-size:12px;color:#333">
        <b>Paciente:</b> ${escapeHtml(data.clientName)}<br/>
        <b>Data:</b> ${formatDate(data.createdAt)}
      </div>
    `)
  );

  // 2. INTERPRETAÇÃO FATIADA
  if (data.interpretacao) {
    const pedacos = dividirTexto(data.interpretacao, MAX_CHARS_POR_BLOCO);
    for (let i = 0; i < pedacos.length; i++) {
      const titulo = i === 0 ? "Interpretação" : "Interpretação (continuação)";
      blocks.push(
        criarBlocoHTML(`
          <div style="font-size:13px;font-weight:900;color:#111;margin-bottom:8px">${titulo}</div>
          <div style="white-space:pre-wrap;color:#222">${escapeHtml(pedacos[i])}</div>
        `)
      );
    }
  }

  // 3. COMPARATIVO
  const comparativoHTML = extrairComparativoHTML(data.comparacao);
  if (comparativoHTML) {
    blocks.push(criarBlocoHTML(comparativoHTML));
  }

// 4. MAPA TÉCNICO E IMPACTO FITNESS (COMPRESSÃO INTELIGENTE POR CATEGORIA)
if (data.diagnostico?.problemas && data.diagnostico.problemas.length > 0) {
  
  // 1. AGRUPAR TODOS OS ITENS PELO SISTEMA (CATEGORIA)
  const grupos: Record<string, typeof data.diagnostico.problemas> = {};
  for (const item of data.diagnostico.problemas) {
    const sys = item.sistema || "Geral";
    if (!grupos[sys]) grupos[sys] = [];
    grupos[sys].push(item);
  }

  // 2. GERAR TEXTO LIMPO E CONCATENADO PARA CADA CATEGORIA
  const categoriasHTML = Object.entries(grupos).map(([sistema, itens]) => {
    
    // Pega os nomes dos itens removendo repetições exatas
    const nomesItens = [...new Set(itens.map(i => i.item))].join(", ");

    // Pega os sintomas (impactos) removendo repetições exatas
    const impactosUnicos = [...new Set(itens.map(i => i.impacto).filter(Boolean))];
    const sintomasStr = impactosUnicos.length > 0 
      ? `<div style="font-size:10px;color:#555;margin:4px 0 6px 0"><b>Sintomas:</b> ${impactosUnicos.join("; ")}</div>` 
      : "";

    // Pega os impactos fitness e junta tudo sem repetir o mesmo texto
    const fitnessMap: Record<string, Set<string>> = {};
    for (const i of itens) {
      if (!i.impacto_fitness) continue;
      for (const [k, v] of Object.entries(i.impacto_fitness)) {
        if (!fitnessMap[k]) fitnessMap[k] = new Set();
        fitnessMap[k].add(String(v));
      }
    }
    const fitnessTags = Object.entries(fitnessMap).map(([k, v]) => {
      const emoji = k === 'performance' ? '💪' : k === 'hipertrofia' ? '🏋️' : k === 'emagrecimento' ? '🔥' : k === 'recuperacao' ? '🩹' : '🧠';
      return `<span style="background:#f0f9ff;color:#0284c7;padding:2px 5px;border-radius:3px;font-size:9px;margin-right:4px">${emoji} ${k}: ${[...v].join(", ")}</span>`;
    }).join("");
    
    const fitnessStr = fitnessTags ? `<div style="margin-top:4px">${fitnessTags}</div>` : "";

    return `
      <div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #e5e7eb">
        <div style="font-weight:800;color:#111;font-size:12px;margin-bottom:4px">${escapeHtml(sistema)}</div>
        <div style="font-size:11px;color:#333">${escapeHtml(nomesItens)}</div>
        ${sintomasStr}
        ${fitnessStr}
      </div>
    `;
  }).join("");

  // 3. FATIAR O TEXTO FINAL APENAS SE FOR GIGANTE (O que é bem improvável agora)
  // Ao invés de fatiar por itens, fatiamos o texto final se passar de 3200 caracteres
  const blocosMapa = dividirTexto(categoriasHTML, MAX_CHARS_POR_BLOCO);
  
  blocosMapa.forEach((pedaco, idx) => {
    const titulo = idx === 0 
      ? `<div style="font-size:13px;font-weight:900;color:#111;margin-bottom:10px">Mapa Técnico e Impacto Fitness</div>` 
      : `<div style="font-size:11px;color:#888;margin-bottom:10px;font-style:italic">Mapa Técnico e Impacto Fitness (continuação)</div>`;
    
    blocks.push(criarBlocoHTML(`${titulo}${pedaco}`));
  });
}

  // =======================================================================
  // 🔥 CORREÇÃO 1: PLANO TERAPÊUTICO DIVIDIDO EM PÁGINAS (NÃO CORTA MAIS)
  // =======================================================================
  if (data.plano_terapeutico?.terapias?.length) {
    const terapias = data.plano_terapeutico.terapias;
    const TERAPIAS_POR_PAGINA = 4;

    for (let i = 0; i < terapias.length; i += TERAPIAS_POR_PAGINA) {
      const chunk = terapias.slice(i, i + TERAPIAS_POR_PAGINA);

      const htmlTerapias = chunk.map((t) => `
        <div style="margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #e5e7eb">
          <div style="font-weight:700;color:#111;font-size:12px">${escapeHtml(t.nome)}</div>
          <div style="font-size:10px;color:#0284c7;margin-bottom:4px"><b>${escapeHtml(t.frequencia || "")}</b></div>
          <div style="color:#333">${escapeHtml(t.descricao || "")}</div>
          ${t.justificativa ? `<div style="font-size:10px;color:#555;margin-top:4px"><b>Justificativa:</b> ${escapeHtml(t.justificativa)}</div>` : ""}
        </div>
      `).join("");

      const titulo = i === 0
        ? `<div style="font-size:13px;font-weight:900;color:#111;margin-bottom:10px">Plano terapêutico</div>`
        : `<div style="font-size:11px;color:#888;margin-bottom:10px;font-style:italic">Plano terapêutico (continuação)</div>`;

      blocks.push(criarBlocoHTML(`${titulo}${htmlTerapias}`));
    }
  }

  // =======================================================================
  // 🔥 CORREÇÃO 2: FREQUÊNCIA LUNARA (SOLFEGGIO) - SEMPRE VISÍVEL
  // =======================================================================
  const frequenciaTexto = data.frequencia_lunara && !/^[\s—\-–]+$/.test(data.frequencia_lunara)
    ? data.frequencia_lunara
    : "Recomendação: Utilizar frequências Solfeggio (ex: 432Hz para harmonização, 528Hz para reparação) durante a sessão para potencializar o resultado terapêutico.";

  let htmlFrequenciaEJustificativa = `
    <div style="font-size:13px;font-weight:900;color:#111;margin-bottom:6px">Frequência Solfeggio para Sessão</div>
    <div style="color:#333;margin-bottom:12px;background:#f8fafc;padding:10px;border-radius:6px;border-left:4px solid #8b5cf6;">
      🎵 ${escapeHtml(frequenciaTexto)}
    </div>
  `;

  if (data.justificativa && !/^[\s—\-–]+$/.test(data.justificativa)) {
    htmlFrequenciaEJustificativa += `
      <div style="font-size:13px;font-weight:900;color:#111;margin-bottom:6px">Justificativa terapêutica</div>
      <div style="color:#333">${escapeHtml(data.justificativa)}</div>
    `;
  }

  // Como o texto padrão sempre é adicionado, esse bloco vai pro PDF 100% das vezes
  blocks.push(criarBlocoHTML(htmlFrequenciaEJustificativa));

  // RENDERIZAÇÃO FINAL
  blocks.forEach((b) => container.appendChild(b));
  document.body.appendChild(container);

  try {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });

    let currentY = 20;
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    for (const block of blocks) {
      const canvas = await renderizarBlocoParaCanvas(block, PDF_CANVAS_SCALE_DEFAULT);
      currentY = adicionarBlocoAoPDF(pdf, canvas, currentY, pageWidth, pageHeight);
    }

    pdf.save(`relatorio-${data.clientName.replace(/\s/g, "_")}.pdf`);
  } finally {
    container.remove();
  }
}