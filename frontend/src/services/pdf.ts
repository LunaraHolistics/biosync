import { jsPDF } from "jspdf";

// ============================================================
// TIPOS LOCAIS (inline — sem dependência externa)
// ============================================================

type PlanoTerapeutico = {
  tipo: "semanal" | "quinzenal" | "mensal";
  terapias: {
    nome: string;
    frequencia: string;
    descricao: string;
    justificativa: string;
  }[];
};

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const LIMITE_ITENS_RELATORIO = 40;
const MAX_CHARS_POR_BLOCO = 4200;

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
// CABEÇALHO PADRÃO (Nativo sem imagens)
// ============================================================

function adicionarCabecalhoNoPDF(
  pdf: jsPDF,
  data: RelatorioData
): number {
  const pageW = pdf.internal.pageSize.getWidth();
  const MARGIN_X = 20;
  const cabecalhoH = 35;
  const y = 10;

  pdf.setFillColor(245, 245, 245);
  pdf.rect(MARGIN_X, y, pageW - MARGIN_X * 2, cabecalhoH, "F");

  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.5);
  pdf.line(MARGIN_X, y + cabecalhoH, pageW - MARGIN_X, y + cabecalhoH);

  pdf.setFont("helvetica", "bold", 14);
  pdf.setTextColor(17, 17, 17);
  pdf.text("BioSync", MARGIN_X + 5, y + 22);

  pdf.setFont("helvetica", "bold", 12);
  pdf.setTextColor(50, 50, 50);
  pdf.text("Relatório Terapêutico Integrativo", pageW / 2, y + 15, {
    align: "center",
  });

  pdf.setFont("helvetica", "normal", 9);
  pdf.setTextColor(85, 85, 85);
  pdf.text(
    `${data.clientName}  |  ${formatDate(data.createdAt)}`,
    pageW / 2,
    y + 28,
    { align: "center" }
  );

  return cabecalhoH + 8;
}

// ============================================================
// GRÁFICO DE COMPARAÇÃO (canvas nativo, sem html2canvas)
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
    if (primeiro) {
      ctx.moveTo(xPos, yPos);
      primeiro = false;
    } else {
      ctx.lineTo(xPos, yPos);
    }
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
    if (primeiro) {
      ctx.moveTo(xPos, yPos);
      primeiro = false;
    } else {
      ctx.lineTo(xPos, yPos);
    }
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
// EXTRAIR DADOS
// ============================================================

function extrairComparativoTexto(comparacao: unknown): string {
  if (!comparacao || typeof comparacao !== "object") return "";

  const c = comparacao as Record<string, unknown>;
  const secoes: {
    titulo: string;
    itens: any[];
  }[] = [
    {
      titulo: "🟢 Melhoraram",
      itens: Array.isArray(c.melhoraram) ? c.melhoraram : [],
    },
    {
      titulo: "🔴 Pioraram",
      itens: Array.isArray(c.pioraram) ? c.pioraram : [],
    },
    {
      titulo: "🟡 Novos Problemas",
      itens: Array.isArray(c.novos_problemas) ? c.novos_problemas : [],
    },
    {
      titulo: "⓪ Normalizados",
      itens: Array.isArray(c.normalizados) ? c.normalizados : [],
    },
  ];

  const total = secoes.reduce((s, sec) => s + sec.itens.length, 0);
  if (total === 0) return "";

  const partes: string[] = [`Evolução entre exames (${total} mudanças)\n`];

  for (const secao of secoes) {
    if (secao.itens.length === 0) continue;
    const linhas = secao.itens
      .slice(0, 10)
      .map(
        (item: any) =>
          `• ${item.item || "—"} - ${item.evolucao || ""} (${item.antes || "—"} → ${item.depois || "—"} ${item.variacao !== undefined ? `| Δ${item.variacao}` : ""})`
      )
      .join("\n");

    partes.push(`${secao.titulo} (${secao.itens.length}):\n${linhas}`);
  }

  return partes.join("\n\n");
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

// ============================================================
// GERAR BLOCOS DE CONTEÚDO (Texto puro extraído)
// ============================================================

function gerarBlocosConteudo(data: RelatorioData): { titulo: string; texto: string }[] {
  const blocos: { titulo: string; texto: string }[] = [];

  if (data.interpretacao) {
    const pedacos = dividirTexto(data.interpretacao, MAX_CHARS_POR_BLOCO);
    for (let i = 0; i < pedacos.length; i++) {
      const titulo = i === 0 ? "Interpretação" : "Interpretação (continuação)";
      blocos.push({
        titulo,
        texto: pedacos[i],
      });
    }
  }

  const compTexto = extrairComparativoTexto(data.comparacao);
  if (compTexto) {
    blocos.push({ titulo: "Comparativo", texto: compTexto });
  }

  if (data.pontos_criticos && data.pontos_criticos.length > 0) {
    const lista = data.pontos_criticos
      .slice(0, 15)
      .map((p) => `• ${p}`)
      .join("\n");
    blocos.push({
      titulo: "Pontos críticos",
      texto: lista,
    });
  }

  if (data.plano_terapeutico?.terapias?.length) {
    const textoTerapias = data.plano_terapeutico.terapias
      .map((t) => {
        let str = `• ${t.nome}`;
        if (t.frequencia) str += `\n  Frequência: ${t.frequencia}`;
        if (t.descricao) str += `\n  Descrição: ${t.descricao}`;
        if (t.justificativa) str += `\n  Justificativa: ${t.justificativa}`;
        return str;
      })
      .join("\n\n");
    
    blocos.push({
      titulo: "Plano terapêutico",
      texto: textoTerapias,
    });
  }

  if (data.relatorio_original_html) {
    const itens = extrairRelatorioOriginal(data.relatorio_original_html);
    if (itens.length > 0) {
      const mapaTexto = itens
        .slice(0, LIMITE_ITENS_RELATORIO)
        .map(
          (i) =>
            `• ${i.sistema} — ${i.item}\n  Normal: ${i.normal || "—"} | Medido: ${i.valor || "—"}`
        )
        .join("\n");
      blocos.push({
        titulo: "Mapa técnico estruturado",
        texto: mapaTexto,
      });
    }
  }

  const extras: string[] = [];
  if (data.frequencia_lunara) {
    extras.push(data.frequencia_lunara);
  }
  if (data.justificativa) {
    extras.push(data.justificativa);
  }
  if (extras.length) {
    blocos.push({
      titulo: "Frequência Lunara e Justificativa Terapêutica",
      texto: extras.join("\n\n"),
    });
  }

  return blocos;
}

// ============================================================
// GERAR PDF
// ============================================================

export async function gerarRelatorioPDF(data: RelatorioData) {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight(); // Corrigido: pdf.length é incorreto no jsPDF

  const MARGIN_X = 20;
  const GAP = 15;
  const RODAPE_Y = pageH - 30;
  const CABECALHO_H = 43;
  const maxY = RODAPE_Y - CABECALHO_H - GAP;

  // 1. Pré-renderizar gráfico (canvas puro)
  const graficoCanvas = criarGraficoComparativoCanvas(data.comparacao);

  // 2. Gerar blocos de conteúdo em texto puro
  const blocosTexto = gerarBlocosConteudo(data);

  // 3. Estado da página
  let currentY = CABECALHO_H;
  let paginaAtual = 0;

  function adicionarCabecalho() {
    adicionarCabecalhoNoPDF(pdf, data);
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

  // Função nativa para desenhar texto com quebra de linha e paginação automática
  function desenharTexto(titulo: string, texto: string) {
    const textMaxWidth = pageW - MARGIN_X * 2 - 10;

    // Desenhar Título
    if (currentY + 25 > maxY) novaPagina();
    
    pdf.setFont("helvetica", "bold", 11);
    pdf.setTextColor(17, 17, 17);
    pdf.text(titulo, MARGIN_X + 5, currentY + 12);
    currentY += 25;

    // Desenhar Texto
    pdf.setFont("helvetica", "normal", 9);
    pdf.setTextColor(50, 50, 50);
    
    const linhas = pdf.splitTextToSize(texto, textMaxWidth);
    const lineHeight = 13;

    for (const linha of linhas) {
      if (currentY + lineHeight > maxY) {
        novaPagina();
        // Reaplica a fonte após trocar de página (o jsPDF reseta algumas vezes)
        pdf.setFont("helvetica", "normal", 9);
        pdf.setTextColor(50, 50, 50);
      }
      pdf.text(linha, MARGIN_X + 5, currentY);
      currentY += lineHeight;
    }

    currentY += GAP; // Espaço após o bloco
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

  // 4. Montar PDF

  adicionarCabecalho();

  if (graficoCanvas) {
    adicionarCanvasComPaginacao(graficoCanvas);
  }

  for (const bloco of blocosTexto) {
    desenharTexto(bloco.titulo, bloco.texto);
  }

  adicionarRodape();

  pdf.save(`relatorio-${data.clientName.replace(/\s/g, "_")}.pdf`);
}