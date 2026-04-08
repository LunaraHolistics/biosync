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

  // 🔥 NOVO
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

//
// 🔥 PARSER DO HTML ORIGINAL
//
function extrairRelatorioOriginal(html: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const linhas = Array.from(doc.querySelectorAll("tr"));
  const resultado: any[] = [];

  let sistemaAtual = "";

  for (const tr of linhas) {
    const tds = tr.querySelectorAll("td");

    if (tds.length < 4) continue;

    if (tds.length >= 5) {
      const sistemaTexto = tds[0]?.textContent?.trim();
      if (sistemaTexto) {
        sistemaAtual = sistemaTexto;
      }
    }

    const item = tds[1]?.textContent?.trim();
    const normal = tds[2]?.textContent?.trim();
    const valor = tds[3]?.textContent?.trim();
    const conselho = tds[4]?.textContent?.trim();

    if (!item) continue;

    resultado.push({
      sistema: sistemaAtual,
      item,
      normal,
      valor,
      conselho,
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
      <div>${escapeHtml(data.interpretacao)}</div>
    `)
  );

  // 🔥 MAPA TÉCNICO ESTRUTURADO
  if (data.relatorio_original_html) {
    const itens = extrairRelatorioOriginal(data.relatorio_original_html);

    blocks.push(
      criarBlocoHTML(`
        <div style="font-weight:900;margin-bottom:10px">
          Mapa técnico estruturado
        </div>
      `)
    );

    for (const i of itens.slice(0, LIMITE_ITENS_RELATORIO)) {
      blocks.push(
        criarBlocoHTML(`
          <div style="border:1px solid #ddd;padding:12px;border-radius:10px">
            <div style="font-weight:900;font-size:13px">
              ${escapeHtml(i.sistema)} — ${escapeHtml(i.item)}
            </div>

            <div style="font-size:12px;margin-top:4px">
              <b>Normal:</b> ${escapeHtml(i.normal || "—")} |
              <b>Medido:</b> ${escapeHtml(i.valor || "—")}
            </div>

            <div style="font-size:12px;margin-top:6px;color:#555">
              ${escapeHtml(i.conselho || "—")}
            </div>
          </div>
        `)
      );
    }
  }

  // IMPACTO FITNESS
  if (data.diagnostico?.problemas?.length) {
    for (const p of data.diagnostico.problemas) {
      if (!p.impacto_fitness) continue;

      blocks.push(
        criarBlocoHTML(`
          <div style="border:1px solid #ddd;padding:14px;border-radius:12px">
            <div style="font-weight:900">${escapeHtml(p.item)}</div>
            <div style="font-size:13px">${escapeHtml(p.impacto)}</div>
          </div>
        `)
      );
    }
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
    blocks.push(criarBlocoHTML(`<div style="font-weight:900">Plano terapêutico</div>`));

    for (const t of data.plano_terapeutico.terapias) {
      blocks.push(
        criarBlocoHTML(`
          <div style="border:1px solid #ddd;padding:14px;border-radius:12px">
            <div style="font-weight:900">${escapeHtml(t.nome)}</div>
            <div style="font-size:12px">${escapeHtml(t.frequencia)}</div>
            <div>${escapeHtml(t.descricao)}</div>
          </div>
        `)
      );
    }
  }

// 🔥 RELATÓRIO ORIGINAL COMPLETO (RAW)
if (data.relatorio_original_html) {
  blocks.push(
    criarBlocoHTML(`
      <div style="font-weight:900;margin-top:20px;margin-bottom:10px">
        Relatório original (referência técnica)
      </div>
    `)
  );

  const raw = document.createElement("div");
  raw.style.width = "694px";
  raw.style.padding = "10px";
  raw.style.background = "#fff";
  raw.innerHTML = data.relatorio_original_html;

  blocks.push(raw);
}

  // FINAL
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