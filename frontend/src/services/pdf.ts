import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { PlanoTerapeutico } from "../types/planoTerapeutico";

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const PDF_CANVAS_SCALE = 2;
const LIMITE_ITENS_RELATORIO = 40;
const MAX_CHARS_POR_BLOCO = 4200;

const LOGO_BIOSYNC_SRC = "/favicon.png";
const LOGO_LUNARA_SRC = "/logo.jpeg";

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

// ============================================================
// HELPERS
// ============================================================

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

// ============================================================
// CARREGAR IMAGEM COMO DATA URL (sem CORS / iframe)
// ============================================================

function imagemParaDataURL(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || 76;
      c.height = img.naturalHeight || 76;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => {
      // Fallback: placeholder cinza
      const c = document.createElement("canvas");
      c.width = 76;
      c.height = 76;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#374151";
      ctx.fillRect(0, 0, 76, 76);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "bold 9px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("LOGO", 38, 38);
      resolve(c.toDataURL("image/png"));
    };
    img.src = src;
  });
}

// ============================================================
// CABEÇALHO DIRETO NO PDF (sem html2canvas)
// ============================================================

function adicionarCabecalhoNoPDF(
  pdf: jsPDF,
  data: RelatorioData,
  logoBiosyncData: string,
  logoLunaraData: string
): number {
  const pageW = pdf.internal.pageSize.getWidth();
  const MARGIN_X = 20;
  const logoSize = 38;

  const cabecalhoH = 48;
  const y = 10;

  // Fundo da faixa do cabeçalho
  pdf.setFillColor(255, 255, 255);
  pdf.rect(MARGIN_X, y, pageW - MARGIN_X * 2, cabecalhoH);
  pdf.fill();

  // Linha separadora
  pdf.setDrawColor(229, 231, 235);
  pdf.setLineWidth(0.5);
  pdf.line(MARGIN_X, y + cabecalhoH, pageW - MARGIN_X, y + cabecalhoH);

  // Logo BioSync (esquerda)
  pdf.addImage(logoBiosyncData, "PNG", MARGIN_X + 4, y + 4, logoSize, logoSize);

  // Logo Lunara (direita)
  pdf.addImage(logoLunaraData, "PNG", pageW - MARGIN_X - 4 - logoSize, y + 4, logoSize, logoSize);

  // Título central
  pdf.setFont("helvetica", "bold", 14);
  pdf.setTextColor(17, 17, 17);
  pdf.text("Relatório Terapêutico Integrativo", pageW / 2, y + 18, { align: "center" });

  // Subtítulo
  pdf.setFont("helvetica", "normal", 9);
  pdf.setTextColor(85, 85, 85);
  pdf.text(
    `${data.clientName}  |  ${formatDate(data.createdAt)}`,
    pageW / 2,
    y + 34,
    { align: "center" }
  );

  return cabecalhoH + 6;
}

// ============================================================
// GRÁFICO DE COMPARAÇÃO (canvas nativo)
// ============================================================

function statusToNum(status: string | null | undefined): number {
  if (!status) return 2;
  const s = String(status).toLowerCase();
  if (s === "baixo" || s.includes("redu")) return 1;
  if (s === "alto" || s.includes("anormal")) return 3;
  return 2;
}

function criarGraficoComparativoCanvas(
  comparacao: unknown
): HTMLCanvasElement | null {
  if (!comparacao || typeof comparacao !== "object") return null;

  const c = comparacao as Record<string, unknown>;
  const itens: {
    item: string;
    antes: number;
    depois: number;
    evolucao: string;
  }[] = [];

  for (const item of Array.isArray(c.melhoraram) ? c.melhoraram : []) {
    itens.push({
      item: String(item.item || ""),
      antes: statusToNum(item.antes),
      depois: statusToNum(item.depois),
      evolucao: "melhora",
    });
  }
  for (const item of Array.isArray(c.pioraram) ? c.pioraram : []) {
    itens.push({
      item: String(item.item || ""),
      antes: statusToNum(item.antes),
      depois: statusToNum(item.depois),
      evolucao: "piora",
    });
  }

  if (itens.length === 0) return null;

  const limitados = itens.slice(0, 12);

  const W = 694;
  const H = 240;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const ml = 55;
  const mr = 15;
  const mt = 25;
  const mb = 50;
  const gw = W - ml - mr;
  const gh = H - mt - mb;

  ctx.fillStyle = "#111";
  ctx.font = "bold 11px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("Comparativo entre exames", W / 2, 6);

  const yLabels = ["Baixo", "Normal", "Alto"];
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i < 3; i++) {
    const val = i + 1;
    const yPos = mt + gh - ((val - 1) / 2) * gh;
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(ml, yPos);
    ctx.lineTo(ml + gw, yPos);
    ctx.stroke();
    ctx.fillStyle = "#888";
    ctx.font = "8px Arial";
    ctx.fillText(yLabels[i], ml - 5, yPos);
  }

  const n = limitados.length;
  const step = n > 1 ? gw / (n - 1) : 0;

  ctx.strokeStyle = "#9ca3af";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  let primeiro = true;
  for (let i = 0; i < n; i++) {
    const d = limitados[i];
    const xPos = ml + i * step;
    const yPos = mt + gh - ((d.antes - 1) / 2) * gh;
    if (primeiro) { ctx.moveTo(xPos, yPos); primeiro = false; }
    else ctx.lineTo(xPos, yPos);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 2;
  ctx.beginPath();
  primeiro = true;
  for (let i = 0; i < n; i++) {
    const d = limitados[i];
    const xPos = ml + i * step;
    const yPos = mt + gh - ((d.depois - 1) / 2) * gh;
    if (primeiro) { ctx.moveTo(xPos, yPos); primeiro = false; }
    else ctx.lineTo(xPos, yPos);
  }
  ctx.stroke();

  for (let i = 0; i < n; i++) {
    const d = limitados[i];
    const xPos = ml + i * step;
    const yPos = mt + gh - ((d.depois - 1) / 2) * gh;
    const cor =
      d.evolucao === "melhora"
        ? "#16a34a"
        : d.evolucao === "piora"
          ? "#dc2626"
          : "#6b7280";
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(xPos, yPos, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cor;
    ctx.beginPath();
    ctx.arc(xPos, yPos, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#444";
  ctx.font = "7px Arial";
  ctx.textAlign = "left";
  for (let i = 0; i < n; i++) {
    const xPos = ml + i * step;
    let label = limitados[i].item;
    if (label.length > 18) label = label.substring(0, 16) + "…";
    ctx.save();
    ctx.translate(xPos, mt + gh + 8);
    ctx.rotate(-Math.PI / 5);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  const legY = mt + gh + 38;
  ctx.font = "8px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const legendas = [
    { cor: "#9ca3af", tracejado: true, label: "Antes" },
    { cor: "#3b82f6", tracejado: false, label: "Depois" },
    { cor: "#16a34a", tracejado: false, label: "Melhorou" },
    { cor: "#dc2626", tracejado: false, label: "Piorou" },
  ];

  let lx = ml;
  for (const leg of legendas) {
    if (leg.tracejado) {
      ctx.strokeStyle = leg.cor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(lx, legY);
      ctx.lineTo(lx + 12, legY);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = leg.cor;
      ctx.beginPath();
      ctx.arc(lx + 6, legY, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#444";
    ctx.fillText(leg.label, lx + 16, legY);
    lx += ctx.measureText(leg.label).width + 28;
  }

  return canvas;
}

// ============================================================
// BLOCOS HTML (só texto — sem imagens)
// ============================================================

function criarBlocoHTML(html: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "694px";
  el.style.padding = "20px";
  el.style.background = "#ffffff";
  el.style.borderRadius = "8px";
  el.style.fontFamily = "Arial, sans-serif";
  el.style.color = "#111111";
  el.style.fontSize = "11px";
  el.style.lineHeight = "17px";
  el.innerHTML = html;
  return el;
}

async function renderizarBlocoParaCanvas(
  el: HTMLElement,
  scale: number
): Promise<HTMLCanvasElement> {
  return html2canvas(el, {
    scale,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
  });
}

// ============================================================
// EXTRAIR DADOS
// ============================================================

function extrairComparativoHTML(comparacao: unknown): string {
  if (!comparacao || typeof comparacao !== "object") return "";
  const c = comparacao as Record<string, unknown>;
  const secoes: {
    titulo: string;
    cor: string;
    itens: any[];
  }[] = [
    { titulo: "🟢 Melhoraram", cor: "#16a34a", itens: Array.isArray(c.melhoraram) ? c.melhoraram : [] },
    { titulo: "🔴 Pioraram", cor: "#dc2626", itens: Array.isArray(c.pioraram) ? c.pioraram : [] },
    { titulo: "🟡 Novos Problemas", cor: "#ca8a04", itens: Array.isArray(c.novos_problemas) ? c.novos_problemas : [] },
    { titulo: "⚪ Normalizados", cor: "#6b7280", itens: Array.isArray(c.normalizados) ? c.normalizados : [] },
  ];
  const total = secoes.reduce((s, sec) => s + sec.itens.length, 0);
  if (total === 0) return "";
  const partes: string[] = [
    `<div style="font-size:12px;font-weight:700;color:#111;margin-bottom:10px">Evolução entre exames (${total} mudanças)</div>`,
  ];
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
        <div style="font-weight:700;color:${secao.cor};margin-bottom:4px">${secao.titulo} (${secao.itens.length})</div>
        ${linhas}
      </div>
    `);
  }
  return partes.join("");
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

function extrairRelatorioOriginalHTML(
  meta: Record<string, unknown>,
  _row: any
): string | undefined {
  if (meta && typeof meta === "object" && "relatorio_original_html" in meta) {
    const val = (meta as any).relatorio_original_html;
    if (typeof val === "string" && val.length > 0) return val;
  }
  return undefined;
}

// ============================================================
// GERAR BLOCOS DE CONTEÚDO (texto dividido antes de renderizar)
// ============================================================

function gerarBlocosConteudo(data: RelatorioData): { html: string }[] {
  const blocos: { html: string }[] = [];

  if (data.interpretacao) {
    const pedacos = dividirTexto(data.interpretacao, MAX_CHARS_POR_BLOCO);
    for (let i = 0; i < pedacos.length; i++) {
      const titulo = i === 0 ? "Interpretação" : "Interpretação (continuação)";
      blocos.push({
        html: `<div style="font-size:12px;font-weight:700;color:#111;margin-bottom:8px">${titulo}</div>
               <div style="white-space:pre-wrap;color:#222;line-height:17px">${escapeHtml(pedacos[i])}</div>`,
      });
    }
  }

  const compHTML = extrairComparativoHTML(data.comparacao);
  if (compHTML) {
    blocos.push({ html: compHTML });
  }

  if (data.pontos_criticos && data.pontos_criticos.length > 0) {
    const lista = data.pontos_criticos
      .slice(0, 15)
      .map((p) => `<li style="margin-bottom:3px;color:#222">${escapeHtml(p)}</li>`)
      .join("");
    blocos.push({
      html: `<div style="font-size:12px;font-weight:700;color:#111;margin-bottom:8px">Pontos críticos</div><ul style="padding-left:18px;margin:0">${lista}</ul>`,
    });
  }

  if (data.plano_terapeutico?.terapias?.length) {
    const terapiasHTML = data.plano_terapeutico.terapias
      .map((t) => `
      <div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #e5e7eb">
        <div style="font-weight:700;color:#111">${escapeHtml(t.nome)}</div>
        <div style="font-size:10px;color:#555;margin-bottom:3px">${escapeHtml(t.frequencia || "")}</div>
        <div style="color:#333">${escapeHtml(t.descricao || "")}</div>
        ${t.justificativa ? `<div style="font-size:10px;color:#666;margin-top:3px"><b>Justificativa:</b> ${escapeHtml(t.justificativa)}</div>` : ""}
      </div>
    `)
      .join("");
    blocos.push({
      html: `<div style="font-size:12px;font-weight:700;color:#111;margin-bottom:8px">Plano terapêutico</div>${terapiasHTML}`,
    });
  }

  if (data.relatorio_original_html) {
    const itens = extrairRelatorioOriginal(data.relatorio_original_html);
    if (itens.length > 0) {
      const mapaHTML = itens
        .slice(0, LIMITE_ITENS_RELATORIO)
        .map((i) => `
        <div style="margin-bottom:5px">
          <b>${escapeHtml(i.sistema)} — ${escapeHtml(i.item)}</b><br/>
          <span style="font-size:10px;color:#555">Normal: ${escapeHtml(i.normal || "—")} | Medido: ${escapeHtml(i.valor || "—")}</span>
        </div>
      `)
        .join("");
      blocos.push({
        html: `<div style="font-size:12px;font-weight:700;color:#111;margin-bottom:8px">Mapa técnico estruturado</div>${mapaHTML}`,
      });
    }
  }

  const extras: string[] = [];
  if (data.frequencia_lunara) {
    extras.push(
      `<div style="font-size:12px;font-weight:700;color:#111;margin-bottom:6px">Frequência Lunara</div><div style="color:#333;margin-bottom:12px">${escapeHtml(data.frequencia_lunara)}</div>`
    );
  }
  if (data.justificativa) {
    extras.push(
      `<div style="font-size:12px;font-weight:700;color:#111;margin-bottom:6px">Justificativa terapêutica</div><div style="color:#333">${escapeHtml(data.justificativa)}</div>`
    );
  }
  if (extras.length) {
    blocos.push({ html: extras.join("") });
  }

  return blocos;
}

// ============================================================
// GERAR PDF
// ============================================================

export async function gerarRelatorioPDF(data: RelatorioData) {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const MARGIN_X = 20;
  const GAP = 10;
  const RODAPE_Y = pageH - 30;
  const CABECALHO_H = 54;
  const maxY = RODAPE_Y - CABECALHO_H - GAP;

  // 1. Carregar logos como data URLs (sem html2canvas)
  const [logoBiosyncData, logoLunaraData] = await Promise.all([
    imagemParaDataURL(LOGO_BIOSYNC_SRC),
    imagemParaDataURL(LOGO_LUNARA_SRC),
  ]);

  // 2. Pré-renderizar gráfico (canvas puro, sem imagens — seguro)
  const graficoCanvas = criarGraficoComparativoCanvas(data.comparacao);

  // 3. Gerar blocos de conteúdo (só texto — seguro para html2canvas)
  const blocosHTML = gerarBlocosConteudo(data);

  // 4. Renderizar blocos como canvas
  const blocosCanvas = await Promise.all(
    blocosHTML.map((b) =>
      renderizarBlocoParaCanvas(criarBlocoHTML(b.html), PDF_CANVAS_SCALE)
    )
  );

  // 5. Estado
  let currentY = CABECALHO_H;
  let paginaAtual = 0;

  function adicionarCabecalho() {
    adicionarCabecalhoNoPDF(pdf, data, logoBiosyncData, logoLunaraData);
  }

  function adicionarRodape() {
    pdf.setFontSize(6.5);
    pdf.setTextColor(150, 150, 150);
    pdf.text(
      "Este relatório é gerado a partir de dados bioelétricos e vibrações quânticas captadas por equipamento BioSync, com base em princípios da medicina integrativa e biofísica. As informações aqui contidas têm caráter complementar e orientativo, não substituindo diagnósticos clínicos convencionais. Para avaliação detalhada, o paciente deve buscar um médico qualificado (clínico geral, endocrinologista, cardiologista ou especialista adequado) e realizar exames laboratoriais diretos de sangue, hormônios, imagem e outros parâmetros clínicos. Os resultados não devem ser interpretados como diagnóstico definitivo.",
      MARGIN_X + 5,
      RODAPE_Y - 16,
      { maxWidth: pageW - MARGIN_X * 2, align: "center" }
    );
  }

  function novaPagina() {
    if (paginaAtual > 0) {
      adicionarRodape();
    }
    pdf.addPage();
    paginaAtual++;
    adicionarCabecalho();
    currentY = CABECALHO_H;
  }

  function adicionarCanvasComPaginacao(canvas: HTMLCanvasElement) {
    const imgW = pageW - MARGIN_X * 2;
    const imgH = (canvas.height * imgW) / canvas.width;

    if (currentY + imgH + GAP > maxY) {
      novaPagina();
    }

    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      MARGIN_X,
      currentY,
      imgW,
      imgH
    );

    currentY += imgH + GAP;
  }

  // 6. Montar PDF

  adicionarCabecalho();

  if (graficoCanvas) {
    adicionarCanvasComPaginacao(graficoCanvas);
  }

  for (const canvas of blocosCanvas) {
    adicionarCanvasComPaginacao(canvas);
  }

  adicionarRodape();

  pdf.save(
    `relatorio-${data.clientName.replace(/\s/g, "_")}.pdf`
  );
}