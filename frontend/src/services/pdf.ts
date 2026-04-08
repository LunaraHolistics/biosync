import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { PlanoTerapeutico } from "../types/planoTerapeutico";

const PDF_CANVAS_SCALE_DEFAULT = 2.5;
const LIMITE_ITENS_RELATORIO = 40;

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

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/on\w+="[^"]*"/g, "");
}

function criarBlocoHTML(html: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "694px";
  el.style.padding = "16px";
  el.style.background = "#ffffff";
  el.style.border = "1px solid #e5e7eb";
  el.style.borderRadius = "16px";
  el.style.fontFamily = "Arial, sans-serif";
  el.innerHTML = html;
  return el;
}

async function renderizarBlocoParaCanvas(el: HTMLElement, scale: number) {
  return html2canvas(el, {
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
  pageHeight: number
) {
  const marginX = 20;
  const maxY = pageHeight - 40;

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

export async function gerarRelatorioPDF(data: RelatorioData) {
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-9999px";
  container.style.width = "794px";
  container.style.padding = "40px";
  container.style.background = "#fff";

  const blocks: HTMLElement[] = [];

  // HEADER
  blocks.push(
    criarBlocoHTML(`
      <div style="font-size:22px;font-weight:900">
        Relatório Terapêutico Integrativo
      </div>
      <div style="margin-top:8px;font-size:13px">
        <b>Paciente:</b> ${escapeHtml(data.clientName)}<br/>
        <b>Data:</b> ${formatDate(data.createdAt)}
      </div>
    `)
  );

  // INTERPRETAÇÃO
  blocks.push(
    criarBlocoHTML(`
      <div style="font-weight:900;margin-bottom:8px">Interpretação</div>
      <div style="white-space:pre-wrap">${escapeHtml(data.interpretacao)}</div>
    `)
  );

  // MAPA TÉCNICO AGRUPADO
  if (data.relatorio_original_html) {
    const itens = extrairRelatorioOriginal(data.relatorio_original_html);

    const linhas = itens.slice(0, LIMITE_ITENS_RELATORIO).map(
      (i) => `
      <div style="margin-bottom:8px">
        <b>${escapeHtml(i.sistema)} — ${escapeHtml(i.item)}</b><br/>
        <span style="font-size:12px">
          Normal: ${escapeHtml(i.normal || "—")} |
          Medido: ${escapeHtml(i.valor || "—")}
        </span>
      </div>
    `
    );

    blocks.push(
      criarBlocoHTML(`
        <div style="font-weight:900;margin-bottom:10px">
          Mapa técnico estruturado
        </div>
        ${linhas.join("")}
      `)
    );
  }

  // PONTOS CRÍTICOS
  blocks.push(
    criarBlocoHTML(`
      <div style="font-weight:900">Pontos críticos</div>
      <ul>
        ${(data.pontos_criticos || [])
        .map((p) => `<li>${escapeHtml(p)}</li>`)
        .join("")}
      </ul>
    `)
  );

  // PLANO TERAPÊUTICO
  if (data.plano_terapeutico?.terapias?.length) {
    const terapias = data.plano_terapeutico.terapias.map(
      (t) => `
      <div style="margin-bottom:10px">
        <b>${escapeHtml(t.nome)}</b><br/>
        <span style="font-size:12px">${escapeHtml(t.frequencia)}</span><br/>
        ${escapeHtml(t.descricao)}
      </div>
    `
    );

    blocks.push(
      criarBlocoHTML(`
        <div style="font-weight:900">Plano terapêutico</div>
        ${terapias.join("")}
      `)
    );
  }

  // HTML ORIGINAL (SANITIZADO)
  if (data.relatorio_original_html) {
    const raw = document.createElement("div");
    raw.style.width = "694px";
    raw.style.padding = "10px";
    raw.style.background = "#fff";
    raw.innerHTML = sanitizeHtml(data.relatorio_original_html);

    blocks.push(raw);
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

    pdf.save(`relatorio-${data.clientName}.pdf`);
  } finally {
    container.remove();
  }
}