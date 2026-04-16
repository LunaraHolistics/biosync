import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { PlanoTerapeutico } from "../types/planoTerapeutico";

const PDF_CANVAS_SCALE_DEFAULT = 2;
const LIMITE_ITENS_RELATORIO = 40;
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

// 4. MAPA TÉCNICO ESTRUTURADO COM IMPACTO FITNESS (FATIADO PARA NÃO CORTAR)
if (data.diagnostico?.problemas && data.diagnostico.problemas.length > 0) {
  const todosItens = data.diagnostico.problemas;
  const ITENS_POR_PAGINA_MAPA = 8; // Limite seguro por bloco

  // Divide a lista de problemas em "páginas" de 8 itens
  for (let i = 0; i < todosItens.length; i += ITENS_POR_PAGINA_MAPA) {
    const chunk = todosItens.slice(i, i + ITENS_POR_PAGINA_MAPA);

    const linhas = chunk.map((i) => {
      // Formata o Impacto Fitness se existir
      let fitnessHtml = "";
      if (i.impacto_fitness) {
        const tags = [];
        if (i.impacto_fitness.performance) tags.push(`💪 Performance: ${i.impacto_fitness.performance}`);
        if (i.impacto_fitness.hipertrofia) tags.push(`🏋️ Hipertrofia: ${i.impacto_fitness.hipertrofia}`);
        if (i.impacto_fitness.emagrecimento) tags.push(`🔥 Emagrecimento: ${i.impacto_fitness.emagrecimento}`);
        if (i.impacto_fitness.recuperacao) tags.push(`🩹 Recuperação: ${i.impacto_fitness.recuperacao}`);
        if (i.impacto_fitness.humor) tags.push(`🧠 Humor: ${i.impacto_fitness.humor}`);

        if (tags.length > 0) {
          fitnessHtml = `<div style="margin-top:4px;font-size:10px;color:#0284c7;background:#f0f9ff;padding:4px 6px;border-radius:4px;">
            ${tags.join("<br>")}
          </div>`;
        }
      }

      return `
        <div style="margin-bottom:8px;padding-bottom:6px;border-bottom:1px dashed #e5e7eb">
          <b style="color:#111">${escapeHtml(i.sistema)} — ${escapeHtml(i.item)}</b> 
          <span style="font-size:10px;color:#dc2626;font-weight:700;">${escapeHtml(i.status || "")}</span>
          ${i.impacto ? `<br/><span style="font-size:10px;color:#555">${escapeHtml(i.impacto)}</span>` : ""}
          ${fitnessHtml}
        </div>
      `;
    }).join("");

    // Título só aparece no primeiro bloco
    const tituloMapa = i === 0
      ? `<div style="font-size:13px;font-weight:900;color:#111;margin-bottom:10px">Mapa Técnico e Impacto Fitness</div>`
      : `<div style="font-size:11px;color:#888;margin-bottom:10px;font-style:italic">Mapa Técnico e Impacto Fitness (continuação)</div>`;

    blocks.push(criarBlocoHTML(`${tituloMapa}${linhas}`));
  }
}

  // 5. PONTOS CRÍTICOS
  if (data.pontos_criticos && data.pontos_criticos.length > 0) {
    const lista = data.pontos_criticos
      .slice(0, 15)
      .map((p) => `<li style="margin-bottom:3px">${escapeHtml(p)}</li>`)
      .join("");

    blocks.push(
      criarBlocoHTML(`
        <div style="font-size:13px;font-weight:900;color:#111;margin-bottom:8px">Pontos críticos</div>
        <ul style="color:#222;padding-left:18px;margin:0">${lista}</ul>
      `)
    );
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