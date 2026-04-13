import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { PlanoTerapeutico } from "../types/planoTerapeutico";

const PDF_CANVAS_SCALE_DEFAULT = 2;
const LIMITE_ITENS_RELATORIO = 40;
const MAX_CHARS_POR_BLOCO = 3200; // CORREÇÃO 1: Limite seguro de texto para não estourar a página

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

// CORREÇÃO 1: Função para dividir textos longos antes de virarem imagem
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

// CORREÇÃO 2: Limpada a lógica complexa de "fatiar imagem" que cortava o texto
// Agora ele apenas joga o bloco para a próxima página se não couber
function adicionarBlocoAoPDF(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  currentY: number,
  pageWidth: number,
  pageHeight: number
): number {
  const marginX = 20;
  const marginBotton = 40; // Aumentado de 30 para 40 para dar margem de segurança no rodapé
  const maxY = pageHeight - marginBotton;

  const imgData = canvas.toDataURL("image/png");
  const imgWidth = pageWidth - marginX * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  // Se couber inteiro na página atual
  if (currentY + imgHeight <= maxY) {
    pdf.addImage(imgData, "PNG", marginX, currentY, imgWidth, imgHeight);
    return currentY + imgHeight + 8;
  }

  // Se não couber, mas já temos pelo menos 20% da imagem visível, 
  // significa que a página está no fim. Pula para a próxima.
  if (currentY + (imgHeight * 0.2) > maxY) {
    pdf.addPage();
    currentY = 20;
  }

  // Adiciona na página atual (que agora é a nova página, se houve pulo)
  pdf.addImage(imgData, "PNG", marginX, currentY, imgWidth, imgHeight);
  return currentY + imgHeight + 8;
}

type ItemExtraido = {
  sistema: string;
  item: string;
  normal: string;
  valor: string;
  conselho: string;
};

function extrairRelatorioOriginal(html: string): ItemExtraido[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const linhas = Array.from(doc.querySelectorAll("tr"));
  const resultado: ItemExtraido[] = [];
  let sistemaAtual = "";

  for (const tr of linhas) {
    const tds = tr.querySelectorAll("td");
    if (tds.length < 4) continue;
    if (tds.length >= 5) {
      const sistemaTexto = tds[0]?.textContent?.trim();
      if (sistemaTexto) sistemaAtual = sistemaTexto;
    }
    const item = tds[1]?.textContent?.trim() || "";
    if (!item) continue;
    resultado.push({
      sistema: sistemaAtual,
      item,
      normal: tds[2]?.textContent?.trim() || "",
      valor: tds[3]?.textContent?.trim() || "",
      conselho: tds[4]?.textContent?.trim() || "",
    });
  }

  return resultado;
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

  blocks.push(
    criarBlocoHTML(`
      <div style="font-size:20px;font-weight:900;color:#111;margin-bottom:8px">
        Relatório Terapêutico Integrativo
      </div>
      <div style="font-size:12px;color:#333">
        <b>Paciente:</b> ${escapeHtml(data.clientName)}<br/>
        <b>Data:</b> ${formatDate(data.createdAt)}
      </div>
    `)
  );

  // CORREÇÃO 3: Dividir a interpretação em vários blocos menores antes de virar HTML
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

  const comparativoHTML = extrairComparativoHTML(data.comparacao);
  if (comparativoHTML) {
    blocks.push(criarBlocoHTML(comparativoHTML));
  }

  if (data.relatorio_original_html) {
    const itens = extrairRelatorioOriginal(data.relatorio_original_html);

    if (itens.length > 0) {
      const linhas = itens.slice(0, LIMITE_ITENS_RELATORIO).map((i) => `
        <div style="margin-bottom:6px">
          <b>${escapeHtml(i.sistema)} — ${escapeHtml(i.item)}</b><br/>
          <span style="font-size:10px;color:#555">
            Normal: ${escapeHtml(i.normal || "—")} |
            Medido: ${escapeHtml(i.valor || "—")}
          </span>
        </div>
      `).join("");

      blocks.push(
        criarBlocoHTML(`
          <div style="font-size:13px;font-weight:900;color:#111;margin-bottom:8px">
            Mapa técnico estruturado
          </div>
          ${linhas}
        `)
      );
    }
  }

  if (data.pontos_criticos && data.pontos_criticos.length > 0) {
    const lista = data.pontos_criticos
      .slice(0, 15)
      .map((p) => `<li style="margin-bottom:3px">${escapeHtml(p)}</li>`)
      .join("");

    blocks.push(
      criarBlocoHTML(`
        <div style="font-size:13px;font-weight:900;color:#111;margin-bottom:8px">Pontos críticos</div>
        <ul style="color:#222;padding-left:18px">${lista}</ul>
      `)
    );
  }

  if (data.plano_terapeutico?.terapias?.length) {
    const terapias = data.plano_terapeutico.terapias.map((t) => `
      <div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #e5e7eb">
        <div style="font-weight:700;color:#111">${escapeHtml(t.nome)}</div>
        <div style="font-size:10px;color:#555;margin-bottom:3px">${escapeHtml(t.frequencia || "")}</div>
        <div style="color:#333">${escapeHtml(t.descricao || "")}</div>
        ${t.justificativa ? `<div style="font-size:10px;color:#666;margin-top:3px"><b>Justificativa:</b> ${escapeHtml(t.justificativa)}</div>` : ""}
      </div>
    `).join("");

    blocks.push(
      criarBlocoHTML(`
        <div style="font-size:13px;font-weight:900;color:#111;margin-bottom:8px">Plano terapêutico</div>
        ${terapias}
      `)
    );
  }

  if (data.frequencia_lunara || data.justificativa) {
    blocks.push(
      criarBlocoHTML(`
        ${data.frequencia_lunara ? `
          <div style="font-size:13px;font-weight:900;color:#111;margin-bottom:6px">Frequência Lunara</div>
          <div style="color:#333;margin-bottom:12px">${escapeHtml(data.frequencia_lunara)}</div>
        ` : ""}
        ${data.justificativa ? `
          <div style="font-size:13px;font-weight:900;color:#111;margin-bottom:6px">Justificativa terapêutica</div>
          <div style="color:#333">${escapeHtml(data.justificativa)}</div>
        ` : ""}
      `)
    );
  }

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