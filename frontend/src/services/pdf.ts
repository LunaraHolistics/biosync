// services/pdf.ts

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { PlanoTerapeutico } from "../types/planoTerapeutico";

// =======================================================================
// ⚙️ CONFIGURAÇÃO GLOBAL (facilita manutenção e testes)
// =======================================================================

export const PDFConfig = {
  canvasScale: 2,
  maxCharsPerBlock: 2400,
  margin: 20,
  footerHeight: 40,
  pageWidthPt: 595, // A4 em pontos
  pageHeightPt: 842,
  contentWidthPx: 694,
  fontSize: {
    title: 18,
    subtitle: 12,
    body: 11,
    small: 9,
  },
  colors: {
    primary: "#0f172a",
    secondary: "#64748b",
    success: "#16a34a",
    warning: "#ca8a04",
    error: "#dc2626",
    info: "#0284c7",
  },
} as const;

// =======================================================================
// 🔥 TIPOS REFORÇADOS
// =======================================================================

export type TrendType = "melhorou" | "piorou" | "estavel" | "novo";

export type ItemScoreEvolucao = {
  item: string;
  categoria: string;
  score_atual: number;
  score_anterior: number | null;
  delta: number;
  trend: TrendType;
  impacto: string;
  impacto_fitness?: {
    performance?: string;
    hipertrofia?: string;
    emagrecimento?: string;
    recuperacao?: string;
    humor?: string;
  };
};

export type ProblemaDiagnostico = {
  sistema: string;
  item: string;
  status: string;
  impacto: string;
  score?: number;
  impacto_fitness?: ItemScoreEvolucao["impacto_fitness"];
};

export type RelatorioData = {
  clientName: string;
  createdAt: string | Date;
  interpretacao: string;
  pontos_criticos: string[];
  diagnostico?: {
    problemas: ProblemaDiagnostico[];
  };
  plano_terapeutico?: PlanoTerapeutico;
  frequencia_lunara: string;
  justificativa: string;
  comparacao?: unknown;
  relatorio_original_html?: string;
  filtros_aplicados?: string[];
  item_scores?: ItemScoreEvolucao[];
  pacienteGenero?: "masculino" | "feminino";
};

export type PDFGenerationOptions = {
  onProgress?: (progress: number, message: string) => void;
  onError?: (error: Error) => void;
  filename?: string;
  includeMetadata?: boolean;
};

// =======================================================================
// 🔥 CLASSES DE ERRO PERSONALIZADAS
// ✅ CORREÇÃO 1: Removido 'public readonly' do construtor (TS1294 - erasableSyntaxOnly)
// =======================================================================

export class PDFGenerationError extends Error {
  code: string;
  context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PDFGenerationError";
    this.code = code;
    this.context = context;
  }
}

export class RenderingError extends PDFGenerationError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "RENDERING_FAILED", context);
    this.name = "RenderingError";
  }
}

export class DataValidationError extends PDFGenerationError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "INVALID_DATA", context);
    this.name = "DataValidationError";
  }
}

// =======================================================================
// 🔥 HELPERS BÁSICOS OTIMIZADOS
// =======================================================================

/**
 * Formata data para padrão pt-BR com fallback seguro
 */
export function formatDate(value: string | Date | undefined | null): string {
  if (!value) return new Date().toLocaleString("pt-BR");

  try {
    const d = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(d.getTime())) return new Date().toLocaleString("pt-BR");

    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return new Date().toLocaleString("pt-BR");
  }
}

/**
 * Escape HTML com memoização para performance
 */
const escapeCache = new Map<string, string>();

export function escapeHtml(text: string): string {
  if (escapeCache.has(text)) return escapeCache.get(text)!;

  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  // Limita cache a 1000 entradas para evitar memory leak
  if (escapeCache.size < 1000) {
    escapeCache.set(text, escaped);
  }

  return escaped;
}

/**
 * Divide texto em blocos respeitando quebras naturais
 */
export function dividirTexto(texto: string, maxChars: number): string[] {
  if (!texto || texto.length <= maxChars) return [texto || ""];

  const pedacos: string[] = [];
  let resto = texto;

  while (resto.length > 0) {
    if (resto.length <= maxChars) {
      pedacos.push(resto);
      break;
    }

    // Tenta quebrar em nova linha primeiro
    let corte = resto.lastIndexOf("\n", maxChars);

    // Se não encontrou, tenta em espaço
    if (corte <= maxChars * 0.3) {
      corte = resto.lastIndexOf(" ", maxChars);
    }

    // Fallback: corte forçado no limite
    if (corte <= maxChars * 0.3) corte = maxChars;

    pedacos.push(resto.substring(0, corte).trimEnd());
    resto = resto.substring(corte).trimStart();
  }

  return pedacos;
}

/**
 * Cria elemento HTML com estilos padronizados para PDF
 */
export function criarBlocoHTML(
  html: string,
  options: {
    comBordaInferior?: boolean;
    backgroundColor?: string;
    extraStyles?: string;
  } = {}
): HTMLDivElement {
  const { comBordaInferior = false, backgroundColor = "#ffffff", extraStyles = "" } = options;

  const el = document.createElement("div");
  el.style.cssText = `
    width: ${PDFConfig.contentWidthPx}px;
    padding: 16px 20px;
    background: ${backgroundColor};
    border-radius: 6px;
    font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
    color: #111111;
    font-size: ${PDFConfig.fontSize.body}px;
    line-height: 15px;
    margin-bottom: 12px;
    ${comBordaInferior ? "border-bottom: 1px solid #e5e7eb;" : ""}
    page-break-inside: avoid;
    break-inside: avoid;
    box-sizing: border-box;
    ${extraStyles}
  `;
  el.innerHTML = html;
  return el;
}

/**
 * Renderiza elemento para canvas com tratamento de erros
 */
export async function renderizarBlocoParaCanvas(
  el: HTMLElement,
  scale: number = PDFConfig.canvasScale
): Promise<HTMLCanvasElement> {
  try {
    return await html2canvas(el, {
      scale,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      scrollY: -window.scrollY,
      removeContainer: true,
      windowWidth: PDFConfig.contentWidthPx + 100,
      windowHeight: el.scrollHeight + 100,
    });
  } catch (error) {
    console.error("Erro ao renderizar canvas:", error);
    throw new RenderingError("Falha ao converter HTML para imagem", {
      elementTag: el.tagName,
      elementId: el.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Adiciona canvas ao PDF com controle de quebra de página
 */
export function adicionarBlocoAoPDF(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  currentY: number,
  options: {
    pageWidth: number;
    pageHeight: number;
    margin?: number;
    footerHeight?: number;
  }
): { newY: number; pageAdded: boolean } {
  const {
    pageWidth,
    pageHeight,
    margin = PDFConfig.margin,
    footerHeight = PDFConfig.footerHeight
  } = options;

  const marginX = margin;
  const maxY = pageHeight - footerHeight;
  const imgData = canvas.toDataURL("image/png");
  const imgWidth = pageWidth - marginX * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  let pageAdded = false;
  let finalY = currentY;

  // Verifica se precisa de nova página
  if (currentY + imgHeight > maxY) {
    pdf.addPage();
    finalY = margin;
    pageAdded = true;
  }

  pdf.addImage(imgData, "PNG", marginX, finalY, imgWidth, imgHeight);

  // Libera memória do canvas imediatamente
  canvas.width = 0;
  canvas.height = 0;

  return {
    newY: finalY + imgHeight + 8,
    pageAdded
  };
}

// =======================================================================
// 🔥 FILTRO DE GÊNERO - VERSÃO ROBUSTA E EXTENSÍVEL
// =======================================================================

/**
 * Normaliza nome de item para comparação consistente
 */
export function normalizarNomeItem(nome: string): string {
  return nome
    .trim()
    .replace(/[:：]$/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Configuração de filtros por gênero - centralizada para fácil manutenção
 */
const GENDER_FILTERS = {
  masculino: [
    "testosterona", "próstata", "prostata", "androgênio", "androgenio", "andrógeno",
    "hormona masculina", "hormônio masculino", "esperma", "espermatozóide", "espermatozoide",
    "ereção", "ejaculação", "líbido masculina", "hipertrofia prostática",
    "volume de sêmen", "motilidade do esperma", "transmissor da ereção",
    "gonadotrofina masculina", "função sexual masculina", "androstenediona",
    "dht", "dihidrotestosterona", "shbg", "globulina ligadora", "hormona masculina"
  ],
  feminino: [
    "estrogênio", "estrogenio", "estrogénio", "progesterona", "prolactina",
    "hormona feminina", "hormônio feminino", "ovário", "ovarios", "útero", "utero",
    "colo uterino", "menstruação", "menstruacao", "ciclo menstrual", "menopausa",
    "gravidez", "amamentação", "amamentacao", "mastite", "cisto ovario",
    "inflamação pélvica", "anexite", "cervicite", "vaginite", "ginecologia",
    "endométrio", "miométrio", "fsh", "lh", "hormona luteinizante", "estrogénio"
  ]
} as const;

/**
 * Filtra itens por gênero do paciente
 */
export function filtrarPorGenero(
  item: string,
  genero?: "masculino" | "feminino"
): boolean {
  if (!genero) return true;

  const itemClean = normalizarNomeItem(item);
  const listaOposta = genero === "masculino"
    ? GENDER_FILTERS.feminino
    : GENDER_FILTERS.masculino;

  return !listaOposta.some(filtro => itemClean.includes(filtro));
}

// =======================================================================
// 🔥 DETECÇÃO DE CATEGORIAS ESPECIAIS (SONO/EMOÇÕES)
// =======================================================================

const CATEGORIAS_ITENS = {
  sono: [
    "sono", "insônia", "insonia", "melatonina", "dormir", "descanso",
    "fadiga", "magnésio", "magnesio", "equilíbrio hepático", "equilibrio hepatico",
    "secreção de bílis", "secrecao de bilis", "triptofano", "gaba",
    "relaxamento", "calma", "ansiedade", "estresse", "cortisol",
    "serotonina", "adrenalina", "sistema nervoso", "neurotransmissor",
    "função de produção de energia", "funcao de producao de energia"
  ],
  emocional: [
    "amor", "alegria", "paz", "iluminismo", "vergonha", "culpa", "apatia",
    "dor", "medo", "desejo", "raiva", "orgulho", "coragem", "neutralidade",
    "vontade", "aceitação", "razão", "nível de consciência", "consciencia humana",
    "sobrecarga mental", "indicador de depressão", "condição das funções neurológicas"
  ]
} as const;

export function isItemSono(item: string): boolean {
  const itemClean = normalizarNomeItem(item);
  return CATEGORIAS_ITENS.sono.some(palavra => itemClean.includes(palavra));
}

export function isItemEmocional(item: string): boolean {
  const itemClean = normalizarNomeItem(item);
  return CATEGORIAS_ITENS.emocional.some(palavra => itemClean.includes(palavra));
}

export function getCategoriaItem(item: string): "sono" | "emocional" | "geral" {
  if (isItemSono(item)) return "sono";
  if (isItemEmocional(item)) return "emocional";
  return "geral";
}

// =======================================================================
// 🔥 COMPARATIVO ENTRE EXAMES - TIPO SEGURO
// =======================================================================

type ComparativoItem = {
  item?: string;
  evolucao?: string;
  antes?: number | string;
  depois?: number | string;
  variacao?: number;
};

type ComparativoSecao = {
  titulo: string;
  cor: string;
  key: string;
};

const SECOES_COMPARATIVO: ComparativoSecao[] = [
  { titulo: "🟢 Melhoraram", cor: PDFConfig.colors.success, key: "melhoraram" },
  { titulo: "🔴 Pioraram", cor: PDFConfig.colors.error, key: "pioraram" },
  { titulo: "🟡 Novos Problemas", cor: PDFConfig.colors.warning, key: "novos_problemas" },
  { titulo: "⚪ Normalizados", cor: PDFConfig.colors.secondary, key: "normalizados" },
];

export function extrairComparativoHTML(comparacao: unknown): string {
  if (!comparacao || typeof comparacao !== "object") return "";

  const c = comparacao as Record<string, unknown>;
  const totalItens = SECOES_COMPARATIVO.reduce((sum, sec) => {
    const itens = c[sec.key];
    return sum + (Array.isArray(itens) ? itens.length : 0);
  }, 0);

  if (totalItens === 0) return "";

  const partes: string[] = [
    `<div style="font-weight:900;margin-bottom:10px;font-size:12px">
      Evolução entre exames (${totalItens} mudanças)
    </div>`
  ];

  for (const secao of SECOES_COMPARATIVO) {
    const itens = c[secao.key];
    if (!Array.isArray(itens) || itens.length === 0) continue;

    const itensValidos = itens.slice(0, 10) as ComparativoItem[];
    const linhas = itensValidos.map(item => `
      <div style="margin-bottom:4px;font-size:10px">
        <b>${escapeHtml(item.item || "—")}</b>
        <span style="color:${secao.cor}"> ${escapeHtml(item.evolucao || "")}</span>
        <span style="font-size:9px;opacity:0.7">
          ${item.antes !== undefined ? escapeHtml(String(item.antes)) : "—"} 
          → 
          ${item.depois !== undefined ? escapeHtml(String(item.depois)) : "—"}
          ${item.variacao !== undefined ? ` | Δ${item.variacao}` : ""}
        </span>
      </div>
    `).join("");

    partes.push(`
      <div style="margin-bottom:10px;padding:8px;background:#f9fafb;border-radius:4px">
        <div style="font-weight:700;color:${secao.cor};margin-bottom:4px;font-size:11px">
          ${secao.titulo} (${itens.length})
        </div>
        ${linhas}
      </div>
    `);
  }

  return partes.join("");
}

// =======================================================================
// 🔥 TABELA DE EVOLUÇÃO - COM FILTRO, DEDUPLICAÇÃO E DESTAQUE
// =======================================================================

export function gerarTabelaEvolucao(
  itemScores: ItemScoreEvolucao[],
  genero?: "masculino" | "feminino"
): string {
  if (!itemScores?.length) return "";

  // 1. Filtrar por gênero
  let filtrados = itemScores.filter(is => filtrarPorGenero(is.item, genero));

  // 2. Deduplicar mantendo item mais crítico
  const mapaUnico = new Map<string, ItemScoreEvolucao>();
  for (const is of filtrados) {
    const chave = normalizarNomeItem(is.item);
    const existente = mapaUnico.get(chave);

    if (!existente ||
      is.score_atual < existente.score_atual ||
      is.impacto.length > existente.impacto.length) {
      mapaUnico.set(chave, { ...is, item: normalizarNomeItem(is.item).replace(/^./, c => c.toUpperCase()) });
    }
  }
  filtrados = Array.from(mapaUnico.values());

  if (!filtrados.length) return "";

  // 3. Ordenar: sono/emoções → impacto → score → alfabético
  const temSono = filtrados.some(is => isItemSono(is.item));
  const temEmocional = filtrados.some(is => isItemEmocional(is.item));

  const ordenados = [...filtrados].sort((a, b) => {
    if (temSono) {
      const aSono = isItemSono(a.item) ? 2 : 0;
      const bSono = isItemSono(b.item) ? 2 : 0;
      if (aSono !== bSono) return bSono - aSono;
    }
    if (temEmocional) {
      const aEmo = isItemEmocional(a.item) ? 1 : 0;
      const bEmo = isItemEmocional(b.item) ? 1 : 0;
      if (aEmo !== bEmo) return bEmo - aEmo;
    }
    if (Math.abs(b.delta) !== Math.abs(a.delta)) return Math.abs(b.delta) - Math.abs(a.delta);
    if (a.score_atual !== b.score_atual) return a.score_atual - b.score_atual;
    return normalizarNomeItem(a.item).localeCompare(normalizarNomeItem(b.item), "pt-BR");
  }).slice(0, 15);

  const linhas = ordenados.map(item => {
    const icon = {
      melhorou: "🟢",
      piorou: "🔴",
      novo: "🆕",
      estavel: "🟡"
    }[item.trend] || "⚪";

    const categoria = getCategoriaItem(item.item);
    const destaque = categoria === "sono"
      ? "background: #fef3c7; border-left: 3px solid #f59e0b; padding-left: 6px;"
      : categoria === "emocional"
        ? "background: #f0f9ff; border-left: 3px solid #3b82f6; padding-left: 6px;"
        : "";

    const deltaStr = item.score_anterior !== null
      ? `${item.delta >= 0 ? "+" : ""}${item.delta}`
      : "—";

    const scoreAnterior = item.score_anterior ?? "—";
    const corDelta = item.delta >= 0 ? PDFConfig.colors.success : PDFConfig.colors.error;
    const corScore = item.score_atual >= 70 ? PDFConfig.colors.success
      : item.score_atual >= 50 ? PDFConfig.colors.warning
        : PDFConfig.colors.error;

    const emoji = categoria === "sono" ? "😴 " : categoria === "emocional" ? "💙 " : "";

    return `
      <tr style="border-bottom: 1px solid #f1f5f9; ${destaque}">
        <td style="padding: 8px 4px; font-size: 10px; font-weight: 600; color: #1e293b; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${emoji}${escapeHtml(item.item)}
        </td>
        <td style="padding: 8px 4px; font-size: 10px; text-align: center; color: #475569;">${scoreAnterior}</td>
        <td style="padding: 8px 4px; font-size: 10px; text-align: center; font-weight: 700; color: ${corScore};">${item.score_atual}</td>
        <td style="padding: 8px 4px; font-size: 10px; text-align: center; font-weight: 700; color: ${corDelta};">${deltaStr}</td>
        <td style="padding: 8px 4px; font-size: 10px; text-align: center;">${icon}</td>
      </tr>
    `;
  }).join("");

  const resumo = {
    melhoraram: ordenados.filter(i => i.trend === "melhorou").length,
    pioraram: ordenados.filter(i => i.trend === "piorou").length,
    estaveis: ordenados.filter(i => i.trend === "estavel").length,
    novos: ordenados.filter(i => i.trend === "novo").length
  };

  const badges = [
    resumo.melhoraram && `<span style="background: #dcfce7; color: #166534; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">🟢 ${resumo.melhoraram} melhoraram</span>`,
    resumo.estaveis && `<span style="background: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">🟡 ${resumo.estaveis} estáveis</span>`,
    resumo.pioraram && `<span style="background: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">🔴 ${resumo.pioraram} pioraram</span>`,
    resumo.novos && `<span style="background: #dbeafe; color: #1e40af; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">🆕 ${resumo.novos} novos</span>`
  ].filter(Boolean).join("");

  const badgeSono = temSono ? '<span style="margin-left: 8px; font-size: 10px; background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-weight: 600;">😴 Sono</span>' : "";
  const badgeEmocional = temEmocional && !temSono ? '<span style="margin-left: 8px; font-size: 10px; background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-weight: 600;">💙 Emoções</span>' : "";

  return `
    <div style="margin: 20px 0; page-break-inside: avoid;" data-pdf-section="evolucao">
      <div style="font-size: 13px; font-weight: 800; color: ${PDFConfig.colors.primary}; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
        <span>📈</span> Evolução dos Principais Itens
        ${badgeSono}${badgeEmocional}
      </div>
      <div style="display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
        ${badges}
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
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `;
}

// =======================================================================
// 🔥 SEÇÃO EXPLICATIVA DE ITENS PRIORITÁRIOS
// =======================================================================

const EXPLICACOES_ITENS: Record<string, { titulo: string; explicacao: string; recomendacao: string }> = {
  // ==============================
  // SONO E RELAXAMENTO
  // ==============================
  "Magnésio": {
    titulo: "Magnésio (Relaxamento e Sono)",
    explicacao: "O magnésio é essencial para o relaxamento muscular, produção de melatonina e regulação do sistema nervoso. Deficiência causa insônia, ansiedade, tensão muscular, cãibras e fadiga crônica.",
    recomendacao: "Suplementação com magnésio quelado ou glicinato (300-400mg/dia), alimentos ricos (castanhas, espinafre, abacate), banhos de sal grosso, evitar café após 14h."
  },
  "Triptofano": {
    titulo: "Triptofano (Precursor de Serotonina e Melatonina)",
    explicacao: "Aminoácido essencial precursor da serotonina (bem-estar) e melatonina (sono). Baixos níveis causam insônia, depressão, ansiedade e compulsão alimentar. O corpo não produz triptofano — precisa vir da dieta.",
    recomendacao: "Alimentos ricos (banana, aveia, leite morno, peru, castanhas, cacau), suplementação (500-1000mg antes de dormir com carboidrato leve), evitar proteínas pesadas à noite que competem pela absorção."
  },
  "Fadiga visual": {
    titulo: "Fadiga Visual (Cansaço Ocular e Mental)",
    explicacao: "Cansaço visual crônico prejudica o ciclo sono-vigília. Excesso de telas e luz azul ativam o sistema nervoso simpático, inibem a produção de melatonina e dificultam o relaxamento noturno.",
    recomendacao: "Regra 20-20-20 (a cada 20min, olhar 20 pés por 20 seg), filtro de luz azul após 18h, óleos essenciais de lavanda nos olhos fechados, pausas ativas a cada hora."
  },
  "Equilíbrio Hepático": {
    titulo: "Equilíbrio Hepático (Metabolismo e Sono)",
    explicacao: "O fígado realiza a desintoxicação noturna entre 23h e 3h. Quando sobrecarregado, o metabolismo de hormônios é prejudicado, a bile fica espessa e o sono é fragmentado. Fígado desregulado = sono ruim.",
    recomendacao: "Evitar álcool e processados, chás digestivos (boldo, carqueja, dente-de-leão), jantar leve até 19h, dormir antes de 23h para permitir a regeneração hepática."
  },
  "Melatonina": {
    titulo: "Melatonina (Hormônio do Sono)",
    explicacao: "Hormônio produzido pela pineal durante a noite. Regula o ritmo circadiano e induz o sono profundo. Luz artificial à noite, estresse e idade reduz sua produção. Baixa melatonina = insônia + envelhecimento acelerado.",
    recomendacao: "Escurecer ambiente 1h antes de dormir, evitar telas, suplementação sublingual (0.3-1mg — doses baixas são mais eficazes), manter horário regular de sono."
  },
  "GABA": {
    titulo: "GABA (Neurotransmissor Inibitório)",
    explicacao: "O GABA é o principal neurotransmissor calmante do cérebro. Reduz a excitabilidade neuronal, promove relaxamento e induz o sono. Deficiência causa ansiedade, insônia, pensamentos acelerados e tensão muscular.",
    recomendacao: "Suplementação com GABA (100-300mg antes de dormir), L-teanina (200mg), alimentos fermentados (kefir, chucrute), meditação e respiração profunda que estimulam produção natural."
  },
  "Serotonina": {
    titulo: "Serotonina (Neurotransmissor do Bem-Estar)",
    explicacao: "Regula humor, sono, apetite e cognição. 95% é produzida no intestino (eixo intestino-cérebro). Baixa serotonina causa depressão, ansiedade, compulsão, insônia e dor aumentada.",
    recomendacao: "Cuidar da microbiota intestinal (probióticos, fibras), exposição solar matinal (estimula produção), exercício físico regular, triptofano na dieta, evitar excesso de açúcar que consome triptofano."
  },
  "Cortisol": {
    titulo: "Cortisol (Hormônio do Estresse)",
    explicacao: "O cortisol deve ser alto de manhã e baixo à noite. Quando cronicamente elevado (estresse crônico), destrói músculo, acumula gordura abdominal, suprime imunidade e bloqueia o sono profundo.",
    recomendacao: "Reduzir estresse (meditação, respiração 4-7-8), evitar cafeína em excesso, exercício moderado (não intenso à noite), ashwagandha (300mg), adaptógenos, dormir 7-8h."
  },
  "Sistema nervoso": {
    titulo: "Sistema Nervoso (Autônomo)",
    explicacao: "Dividido em simpático (luta/fuga) e parassimpático (descanso/digestão). Desequilíbrio com predomínio simpático causa taquicardia, insônia, ansiedade e má digestão. O corpo fica 'travado' no modo alerta.",
    recomendacao: "Ativar o parassimpático: respiração diafragmática lenta (4-7-8), meditação, banho morno antes de dormir, massagem, yoga suave, reduzir estímulos digitais."
  },

  // ==============================
  // EMOÇÕES E NÍVEL DE CONSCIÊNCIA
  // ==============================
  "Apatia": {
    titulo: "Apatia (Nível de Consciência: 20)",
    explicacao: "A apatia é um estado de ausência de energia emocional e motivação. Indica esgotamento do sistema nervoso, possível depressão mascarada ou desconexão entre pensamento e ação. A pessoa 'funciona' mas não sente.",
    recomendacao: "Investigar causas: depressão, burnout, deficiência de dopamina/serotonina, problemas tireoidianos. Terapia cognitivo-comportamental, exercício leve (caminhada), exposição solar, suplementação com vitamina D e omega-3."
  },
  "Culpa": {
    titulo: "Culpa (Nível de Consciência: 30)",
    explicacao: "A culpa crônica é uma emoção tóxica que consome energia mental e física. Está ligada a padrões de pensamento ruminativo, perfeccionismo e traumas de infância. Corroa a autoestima e gera tensão muscular crônica.",
    recomendacao: "Terapia de perdão (perdoar a si mesmo), journaling de gratidão, flores de Bach (Pine para autocrítica, Walnut para mudanças), identificar e desafiar crenças irracionais sobre responsabilidade."
  },
  "Vergonha": {
    titulo: "Vergonha (Nível de Consciência: 20)",
    explicacao: "A vergonha é a emoção mais destrutiva para a autoestima. Diferente da culpa (eu fiz algo errado), a vergonha diz 'eu sou errado'. Causa retração social, ansiedade, hipervigilância e problemas psicossomáticos.",
    recomendacao: "Trabalhar com terapeuta especializado em vergonha tóxica, praticar autocompaixão (exercícios de Kristin Neff), identidade separada do desempenho, florais de Bach (Crab Apple para limpeza de autoimagem)."
  },
  "Medo": {
    titulo: "Medo (Nível de Consciência: 100)",
    explicacao: "O medo é uma emoção de proteção natural, mas quando crônico paralisa a vida. Ativa o sistema nervoso simpático constantemente, gerando cortisol elevado, insônia, tensão muscular, problemas digestivos e fobias.",
    recomendacao: "Exposição gradual ao medo, técnicas de grounding (5-4-3-2-1), EMDR para traumas, suplementação com magnésio e L-teanina, florais de Bach (Mimulus para medos conhecidos, Rock Rose para pânico)."
  },
  "Raiva": {
    titulo: "Raiva (Nível de Consciência: 150)",
    explicacao: "A raiva reprimida ou crônica afeta o fígado (medicina chinesa), aumenta a pressão arterial, causa dores de cabeça e inflamação. Quando expressa destrutivamente, danifica relacionamentos. Quando reprimida, vira depressão.",
    recomendacao: "Canais saudáveis de expressão: exercício intenso, artes marciais, escrita terapêutica. Identificar gatilhos, aprender comunicação não-violenta, florais de Bach (Cherry Plum para perda de controle, Holly para raiva por inveja)."
  },
  "Tristeza": {
    titulo: "Tristeza (Nível de Consciência: 75)",
    explicacao: "A tristeza é uma emoção natural de processamento de perdas. Porém, quando prolongada além de 2 semanas, pode indicar depressão. Afeta o sistema imunológico, a energia e a motivação. Tristeza crônica consome serotonina.",
    recomendacao: "Se > 2 semanas: avaliação profissional para depressão. Terapia, exercício aeróbico (20min já eleva serotonina), exposição solar, conexão social, evitar isolamento. Florais de Bach (Mustard para tristeza sem causa, Star of Bethlehem para luto)."
  },
  "Ansiedade": {
    titulo: "Ansiedade (Nível de Consciência: 100)",
    explicacao: "A ansiedade crônica mantém o cérebro em estado de alerta permanente, esgotando neurotransmissores (GABA, serotonina). Causa palpitações, insônia, tensão muscular, problemas digestivos e névoa mental. Pode ser causada por desequilíbrio bioquímico.",
    recomendacao: "Avaliar deficiências (magnésio, vitamina B6, ferro, zinco), reduzir cafeína, exercício regular, terapia cognitivo-comportamental, suplementação (L-teanina 200mg, ashwagandha 300mg, magnésio quelado), técnicas de respiração."
  },
  "Estresse": {
    titulo: "Estresse (Eixo HPA Desregulado)",
    explicacao: "O estresse crônico sobrecarrega o eixo hipotálamo-hipófise-adrenal (HPA), mantendo cortisol elevado. Isso destrói músculo, acumula gordura visceral, suprime imunidade, prejudica memória e bloqueia o sono reparador.",
    recomendacao: "Medicação: reduzir fontes de estresse quando possível. Suplementação: ashwagandha, rhodiola, magnésio. Técnicas: meditação (10min/dia já reduz cortisol), respiração 4-7-8, exercício moderado, dormir 7-8h, adaptógenos."
  },
  "Frustração": {
    titulo: "Frustração (Nível de Consciência: 125)",
    explicacao: "A frustração surge quando expectativas não são atendidas. Crônica, gera irritabilidade, agressividade, desânimo e desistência. Está ligada à dopamina — quando a recompensa esperada não vem, o cérebro 'desliga' a motivação.",
    recomendacao: "Revisar expectativas (são realistas?), praticar aceitação radical, celebrar pequenas conquistas, terapia para padrões de pensamento rígido, florais de Bach (Impatiens para impaciência, Willow para ressentimento)."
  },
  "Insegurança": {
    titulo: "Insegurança (Autoestima Fragilizada)",
    explicacao: "A insegurança crônica tem raiz em experiências de rejeição, comparação social excessiva e vínculos infantis instáveis. Ativa o mesmo circuito neural que a dor física. Causa ansiedade social, perfeccionismo e evitação de desafios.",
    recomendacao: "Terapia focada em autoestima e esquemas cognitivos, reduzir comparação social (limitar redes), praticar autocompaixão, florais de Bach (Larch para falta de confiança, Cerato para buscar aprovação), construir pequenas vitórias."
  },
  "Solidão": {
    titulo: "Solidão (Nível de Consciência: 50)",
    explicacao: "A solidão crônica é tão prejudicial à saúde quanto fumar 15 cigarros/dia (estudos). Ativa respostas inflamatórias crônicas, eleva cortisol, prejudica imunidade e aumenta risco cardiovascular. Não é sobre estar só — é sobre se sentir desconectado.",
    recomendacao: "Conexão social de qualidade (não quantidade), grupos de interesse compartilhado, voluntariado, terapia para padrões de isolamento, adotar um animal de estimação, florais de Bach (Water Violet para isolamento por orgulho, Heather para necessidade de atenção)."
  },
  "Amor": {
    titulo: "Amor (Nível de Consciência: 500)",
    explicacao: "O amor é o estado emocional mais elevado mensurável. Indica capacidade de conexão, empatia e aceitação incondicional. Score baixo sugere bloqueios emocionais, ressentimentos não resolvidos, medo de vulnerabilidade ou desconexao de si mesmo.",
    recomendacao: "Práticas de gratidão diária, terapia de perdão, meditação do coração (tapping no centro do peito), journaling emocional, flores de Bach (Walnut para adaptação, Holly para inveja/ciúme, Chicory para amor possessivo)."
  },
  "Dor": {
    titulo: "Dor (Nível de Consciência: 75)",
    explicacao: "A dor emocional crônica ativa as mesmas áreas cerebrais que a dor física. Pode ser causada por traumas não processados, luto não resolvido, abuso ou abandono. Quando reprimida, se manifesta como sintomas físicos (psicossomática).",
    recomendacao: "Não reprimir — permitir sentir. Terapia EMDR para traumas, journaling emocional, florais de Bach (Star of Bethlehem para choque/trauma, Rescue Remedy para crises), atividade física como liberação, buscar ajuda profissional se persistir."
  },
  "Desejo": {
    titulo: "Desejo (Nível de Consciência: 125)",
    explicacao: "O desejo é a força motivacional básica, mas quando desregulado vira compulsão, apego e insatisfação crônica. Está ligado à dopamina — o 'neurotransmissor da busca'. Score baixo indica apatia ou desesperança; muito alto indica compulsão.",
    recomendacao: "Equilibrar dopamina: evitar 'superestímulos' (redes, pornografia, açúcar, compras), praticar jejum de dopamina periódico, definir metas realistas com recompensas intermediárias, mindfulness para observar impulsos sem agir."
  },
  "Orgulho": {
    titulo: "Orgulho (Nível de Consciência: 175)",
    explicacao: "O orgulho saudável fortalece a autoestima. O orgulho tóxico (arrogância) cria rigidez, dificulta pedir ajuda e danifica relacionamentos. Quando baseado em aparências, é frágil e gera ansiedade de manutenção.",
    recomendacao: "Distinguir orgulho saudável de arrogância, praticar humildade ativa, reconhecer próprias limitações com serenidade, florais de Bach (Vine para autoritarismo, Beech para intolerância), desenvolver empatia genuína."
  },
  "Coragem": {
    titulo: "Coragem (Nível de Consciência: 200)",
    explicacao: "A coragem é o ponto de inflexão — primeiro nível onde a energia é construtiva (acima de 200). Indica capacidade de agir apesar do medo. Score baixo sugere paralisia por medo, evitação de conflitos e submissão excessiva.",
    recomendacao: "Exposição gradual a situações desafiadoras, fixar metas pequenas e alcançáveis, celebrar cada ato de coragem, florais de Bach (Mimulus para medos conhecidos, Larch para falta de confiança), terapia para identificar e superar bloqueios."
  },
  "Aceitação": {
    titulo: "Aceitação (Nível de Consciência: 350)",
    explicacao: "A aceitação não é conformismo — é reconhecer a realidade sem resistência interna. Score baixo indica luta constante contra o que é, negação, raiva reprimida ou dificuldade em lidar com mudanças. A aceitação libera energia para ação eficaz.",
    recomendacao: "Praticar aceitação radical (DBT), distinguir o que pode/muda mudar do que não pode, oração da serenidade, terapia focada em flexibilidade psicológica, florais de Bach (Walnut para adaptação a mudanças, Walnut + Oak para resistência)."
  },

  // ==============================
  // MINERAIS E VITAMINAS
  // ==============================
  "Potássio": {
    titulo: "Potássio (Equilíbrio Eletrolítico)",
    explicacao: "Mineral essencial para função muscular, nervosa e equilíbrio hidroeletrolítico. Deficiência causa cãibras, fadiga, arritmias, sono fragmentado e pressão alta. Perde-se em suor, diuréticos e estresse.",
    recomendacao: "Alimentos ricos (banana, batata-doce, abacate, espinafre, feijão, tomate), evitar diuréticos em excesso, suplementar apenas se prescrito (excesso de potássio é perigoso para rins)."
  },
  "Cálcio": {
    titulo: "Cálcio (Estrutura Óssea e Sinalização Neural)",
    explicacao: "Além dos ossos, o cálcio é crucial para contração muscular, coagulação e transmissão nervosa. Deficiência causa osteoporose, cãibras, unhas fracas e problemas cardíacos. Necessita vitamina D para absorção.",
    recomendacao: "Laticínios, brócolis, sardinha com osso, gergelim, tofu. Suplementar com vitamina D3 (2000-4000 UI). Evitar excesso de sódio que aumenta excreção de cálcio."
  },
  "Zinco": {
    titulo: "Zinco (Imunidade e Reparação Tecidual)",
    explicacao: "Essencial para imunidade, cicatrização, saúde da pele e produção hormonal. Deficiência causa queda de imunidade, queda de cabelo, unhas fracas, acne, alteração do paladar e fadiga. Vegéticos são mais vulneráveis.",
    recomendacao: "Ostras, carnes vermelhas, sementes de abóbora, nozes, leguminosas. Suplementação: picolinato de zinco 15-30mg/dia (não exceder 40mg sem orientação). Associar com cobre para equilíbrio."
  },
  "Ferro": {
    titulo: "Ferro (Transporte de Oxigênio)",
    explicacao: "Componente da hemoglobina que carrega oxigênio no sangue. Deficiência causa anemia, fadiga crônica, palidez, falta de ar, queda de cabelo e unhas em colher. Mulheres menstruantes são o grupo mais afetado.",
    recomendacao: "Carnes vermelhas, fígado, feijão, lentilha, espinafre. Associar com vitamina C (laranja, limão) para aumentar absorção. Evitar chá/café nas refeições (inibem absorção). Suplementar apenas com dosagem confirmada por exame."
  },

  // ==============================
  // SISTEMAS FISIOLÓGICOS
  // ==============================
  "Metais Pesados": {
    titulo: "Metais Pesados (Toxicidade Sistêmica)",
    explicacao: "Acúmulo de chumbo, mercúrio, cádmio e alumínio causa toxicidade sistêmica crônica. Sintomas: fadiga crônica, névoa mental, dores articulares, distúrbios do sono, problemas de pele e desequilíbrio hormonal. Fontes: peixes grandes, panelas alumínio, vacinas, cosméticos.",
    recomendacao: "Desintoxicação: coentro (+chlorella para quelar e excretar), zeolita, sauna, evitar peixes predadores (atum, tubarão), trocar panelas de alumínio por aço inox/ferro, filtrar água, checking odontológico para amálgamas."
  },
  "Colesterol": {
    titulo: "Colesterol (Metabolismo Lipídico)",
    explicacao: "O colesterol é essencial (hormônios, membranas celulares, vitamina D). O problema é o desequilíbrio: LDL alto + HDL baixo = risco cardiovascular. Inflamação crônica e estresse oxidativo são as verdadeiras causas de placa arterial, não apenas o colesterol.",
    recomendacao: "Reduzir açúcar e processados (maior causa de inflamação), aumentar fibras (aveia, leguminosas), exercício aeróbico regular, ômega-3 (peixe, sardinha), dormir bem. O colesterol dietético tem pouco impacto no sanguíneo."
  },
  "Glicemia": {
    titulo: "Glicemia (Equilíbrio do Açúcar no Sangue)",
    explicacao: "A glicemia desregulada (resistência à insulina) é a porta de entrada para diabetes tipo 2, síndrome metabólica, esteatose hepática e inflamação crônica. Causa fadiga após refeições, ganho de peso abdominal e fome frequente.",
    recomendacao: "Reduzir carboidratos refinados e açúcar, priorizar proteína e gordura boa no café da manhã, exercício muscular (aumenta sensibilidade à insulina), canela (1-2g/dia melhora sensibilidade), jejum intermitente (se orientado), cromo picolinato."
  },
  "Tiroide": {
    titulo: "Tiroide (Regulador Metabólico Central)",
    explicacao: "A tireoide controla o metabolismo de TODAS as células. Hipotireoidismo causa fadiga, ganho de peso, frio excessivo, queda de cabelo, depressão e colesterol alto. Hipertireoidismo causa taquicardia, ansiedade, emagrecimento e insônia.",
    recomendacao: "Exames completos (TSH, T3 livre, T4 livre, anti-TPO), selênio (200mcg/dia para tireoidite de Hashimoto), evitar soja em excesso, iodo adequado (sal iodado, peixe), gerenciar estresse (cortisol suprime conversão T4→T3)."
  },
  "Fígado": {
    titulo: "Fígado (Central de Desintoxicação)",
    explicacao: "O fígado realiza mais de 500 funções: desintoxicação, produção de bile, metabolismo de hormônios, armazenamento de vitaminas. Quando sobrecarregado (álcool, processados, estresse), causa fadiga, digestão ruim, pele amarelada, colesterol alto e insônia.",
    recomendacao: "Evitar álcool e ultraprocessados, chás hepatoprotetores (boldo, carqueja, dente-de-leão, alcachofra), comer brócolis e alho (ativam enzimas desintoxicantes), jantar leve, manter hidratação, considerar NAC (N-acetilcisteína)."
  },
};

export function gerarSecaoExplicativa(itemScores: ItemScoreEvolucao[]): string {
  if (!itemScores?.length) return "";

  const itensCriticos = itemScores
    .filter(is => is.score_atual < 60 && (isItemSono(is.item) || isItemEmocional(is.item)))
    .sort((a, b) => a.score_atual - b.score_atual)
    .slice(0, 5);

  if (!itensCriticos.length) return "";

  const htmlExplicacoes = itensCriticos.map(is => {
    const nome = normalizarNomeItem(is.item);
    const info = EXPLICACOES_ITENS[nome] || {
      titulo: nome.replace(/^./, c => c.toUpperCase()),
      explicacao: isItemEmocional(nome)
        ? "Estado emocional que influencia qualidade de vida, sono e bem-estar. Score baixo indica necessidade de trabalho emocional e autocuidado."
        : "Desequilíbrio bioenergético que impacta sono, energia e bem-estar geral.",
      recomendacao: "Avaliação profissional recomendada para protocolo personalizado."
    };

    const corBadge = is.score_atual < 30 ? PDFConfig.colors.error
      : is.score_atual < 50 ? "#f97316"
        : PDFConfig.colors.warning;
    const labelScore = is.score_atual < 30 ? "Crítico"
      : is.score_atual < 50 ? "Atenção"
        : "Moderado";

    const emoji = isItemSono(nome) ? "😴" : isItemEmocional(nome) ? "💙" : "⚠️";

    return `
      <div style="margin-bottom: 12px; padding: 12px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-left: 4px solid #f59e0b; border-radius: 6px;">
        <div style="font-weight: 800; color: #92400e; font-size: 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          ${emoji} ${info.titulo} 
          <span style="background: ${corBadge}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">
            Score: ${is.score_atual} • ${labelScore}
          </span>
        </div>
        <div style="font-size: 10px; color: #78350f; margin-bottom: 6px; line-height: 1.5;">
          <b style="color: #92400e;">O que é:</b> ${info.explicacao}
        </div>
        <div style="font-size: 10px; color: #78350f; line-height: 1.5;">
          <b style="color: #92400e;">Recomendações:</b> ${info.recomendacao}
        </div>
      </div>
    `;
  }).join("");

  return `
    <div style="margin: 24px 0; page-break-inside: avoid;" data-pdf-section="explicacoes">
      <div style="font-size: 14px; font-weight: 900; color: ${PDFConfig.colors.primary}; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 20px;">🔍</span> 
        Por Que Estes Itens Estão Destacados?
      </div>
      <div style="font-size: 10px; color: #64748b; margin-bottom: 12px; font-style: italic; padding: 8px; background: #f8fafc; border-radius: 6px;">
        Itens relacionados ao sono, emoções e bem-estar com score crítico (&lt; 60) que requerem atenção prioritária:
      </div>
      ${htmlExplicacoes}
      <div style="margin-top: 12px; padding: 10px; background: #dbeafe; border-radius: 6px; border-left: 4px solid #3b82f6;">
        <div style="font-size: 10px; color: #1e40af; font-weight: 700; margin-bottom: 4px;">💡 Dica Importante:</div>
        <div style="font-size: 10px; color: #1e40af;">
          A correção destes desequilíbrios pode levar de 2 a 8 semanas com protocolo adequado. 
          Priorize sono antes de 23h, alimentação limpa, gerenciamento de estresse e acompanhamento profissional.
        </div>
      </div>
    </div>
  `;
}

// =======================================================================
// 🔥 VALIDAÇÃO DE DADOS
// =======================================================================

export function validarDadosRelatorio(data: RelatorioData): asserts data is RelatorioData {
  if (!data?.clientName?.trim()) {
    throw new DataValidationError("Nome do cliente é obrigatório", { field: "clientName" });
  }
  if (!data?.createdAt) {
    throw new DataValidationError("Data de criação é obrigatória", { field: "createdAt" });
  }
  if (!Array.isArray(data?.pontos_criticos)) {
    throw new DataValidationError("pontos_criticos deve ser um array", { field: "pontos_criticos" });
  }
}

// =======================================================================
// 🔥 EXPORTAÇÕES PARA TESTES (declarado antes para estar disponível)
// =======================================================================

if (typeof window !== "undefined") {
  // ✅ CORREÇÃO: Window → unknown → Record (duplo cast necessário pois Window não tem index signature)
  (window as unknown as Record<string, unknown>).PDFUtils = {
    formatDate,
    escapeHtml,
    dividirTexto,
    filtrarPorGenero,
    isItemSono,
    isItemEmocional,
    getCategoriaItem,
    normalizarNomeItem,
    gerarTabelaEvolucao,
    gerarSecaoExplicativa,
    extrairComparativoHTML,
    PDFConfig,
  };
}

// =======================================================================
// 🔥 FUNÇÃO PRINCIPAL: gerarRelatorioPDF
// =======================================================================

export async function gerarRelatorioPDF(
  data: RelatorioData,
  options: PDFGenerationOptions = {}
): Promise<void> {
  const {
    onProgress,
    onError,
    filename,
    includeMetadata = true
  } = options;

  try {
    // Validar dados de entrada
    validarDadosRelatorio(data);

    onProgress?.(5, "Preparando conteúdo...");

    // Criar container off-screen
    const container = document.createElement("div");
    container.style.cssText = `
      position: fixed;
      left: -9999px;
      top: 0;
      width: ${PDFConfig.contentWidthPx + 100}px;
      padding: 24px;
      background: #ffffff;
      box-sizing: border-box;
      z-index: -1;
    `;

    const blocks: HTMLElement[] = [];

    // 1. CABEÇALHO
    const dataExibicao = data.createdAt instanceof Date
      ? data.createdAt
      : new Date(data.createdAt);

    const filtrosHTML = data.filtros_aplicados?.length
      ? `<div style="font-size:10px;color:${PDFConfig.colors.info};margin-top:4px">
          🔍 Filtro: ${data.filtros_aplicados.map(f => f === "emotional" ? "Emocional" : f).join(", ")}
        </div>`
      : "";

    blocks.push(
      criarBlocoHTML(`
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-size:${PDFConfig.fontSize.title}px;font-weight:900;color:${PDFConfig.colors.primary}">BioSync Report</div>
            <div style="font-size:${PDFConfig.fontSize.subtitle}px;color:${PDFConfig.colors.secondary}">Relatório Terapêutico Integrativo</div>
          </div>
          <div style="text-align:right;font-size:${PDFConfig.fontSize.small}px;color:${PDFConfig.colors.secondary}">
            <b>${escapeHtml(data.clientName)}</b><br/>
            ${formatDate(dataExibicao)}
          </div>
        </div>
        ${filtrosHTML}
      `, { comBordaInferior: true })
    );

    onProgress?.(15, "Processando interpretação...");

    // 2. INTERPRETAÇÃO
    if (data.interpretacao?.trim()) {
      const pedacos = dividirTexto(data.interpretacao, PDFConfig.maxCharsPerBlock);
      for (let i = 0; i < pedacos.length; i++) {
        const titulo = i === 0 ? "📋 Interpretação" : "Interpretação (cont.)";
        blocks.push(
          criarBlocoHTML(`
            <div style="font-size:12px;font-weight:800;color:${PDFConfig.colors.primary};margin-bottom:6px">${titulo}</div>
            <div style="white-space:pre-wrap;color:#334155;font-size:11px;line-height:16px">${escapeHtml(pedacos[i])}</div>
          `, { comBordaInferior: i < pedacos.length - 1 })
        );
      }
    }

    onProgress?.(30, "Analisando pontos críticos...");

    // 3. PONTOS CRÍTICOS
    if (data.pontos_criticos?.length) {
      let pontosFiltrados = data.pontos_criticos
        .filter(p => filtrarPorGenero(p, data.pacienteGenero))
        .map(p => normalizarNomeItem(p));

      pontosFiltrados = [...new Set(pontosFiltrados)];

      const pontosSono = pontosFiltrados.filter(p => isItemSono(p));
      const pontosEmocionais = pontosFiltrados.filter(p => isItemEmocional(p) && !isItemSono(p));
      const pontosOutros = pontosFiltrados.filter(p => !isItemSono(p) && !isItemEmocional(p));
      const listaOrdenada = [...pontosSono, ...pontosEmocionais, ...pontosOutros].slice(0, 8);

      if (listaOrdenada.length) {
        const listaHTML = listaOrdenada.map(p => {
          const categoria = getCategoriaItem(p);
          const cor = categoria === "sono" ? "#92400e" : categoria === "emocional" ? "#1e40af" : "#334155";
          const emoji = categoria === "sono" ? "😴 " : categoria === "emocional" ? "💙 " : "";
          return `<li style="margin-bottom:3px;font-size:11px;color:${cor};font-weight:${categoria !== "geral" ? "600" : "400"}">${emoji}${escapeHtml(p)}</li>`;
        }).join("");

        const temSono = pontosSono.length > 0;
        const temEmocional = pontosEmocionais.length > 0;
        const tituloDestaque = temSono
          ? '⚠️ Pontos Críticos <span style="font-size:10px;color:#92400e;font-weight:400">(Sono em destaque)</span>'
          : temEmocional
            ? '⚠️ Pontos Críticos <span style="font-size:10px;color:#1e40af;font-weight:400">(Emoções em destaque)</span>'
            : '⚠️ Pontos Críticos';

        blocks.push(
          criarBlocoHTML(`
            <div style="font-size:12px;font-weight:800;color:${PDFConfig.colors.primary};margin-bottom:6px">${tituloDestaque}</div>
            <ul style="margin:0;padding-left:18px;list-style-type:disc">${listaHTML}</ul>
          `, { comBordaInferior: true })
        );
      }
    }

    onProgress?.(45, "Gerando tabela de evolução...");

    // 4. TABELA DE EVOLUÇÃO
    if (data.item_scores?.length) {
      const tabelaHTML = gerarTabelaEvolucao(data.item_scores, data.pacienteGenero);
      if (tabelaHTML) {
        blocks.push(criarBlocoHTML(tabelaHTML, { comBordaInferior: true }));
      }

      const explicacoesHTML = gerarSecaoExplicativa(data.item_scores);
      if (explicacoesHTML) {
        blocks.push(criarBlocoHTML(explicacoesHTML, { comBordaInferior: true }));
      }
    }

    onProgress?.(60, "Processando comparativo...");

    // 5. COMPARATIVO
    const comparativoHTML = extrairComparativoHTML(data.comparacao);
    if (comparativoHTML) {
      blocks.push(criarBlocoHTML(comparativoHTML, { comBordaInferior: true }));
    }

    onProgress?.(75, "Montando mapa técnico...");

    // 6. MAPA TÉCNICO
    if (data.diagnostico?.problemas?.length) {
      const problemasFiltrados = data.diagnostico.problemas
        .filter(p => filtrarPorGenero(p.item, data.pacienteGenero))
        .map(p => ({ ...p, item: normalizarNomeItem(p.item) }));

      const mapaUnico = new Map<string, ProblemaDiagnostico>();
      for (const p of problemasFiltrados) {
        const chave = `${p.sistema}|${p.item.toLowerCase()}`;
        if (!mapaUnico.has(chave) || (p.score ?? 100) < (mapaUnico.get(chave)?.score ?? 100)) {
          mapaUnico.set(chave, p);
        }
      }
      const problemasUnicos = Array.from(mapaUnico.values());

      if (problemasUnicos.length) {
        const grupos: Record<string, ProblemaDiagnostico[]> = {};
        for (const item of problemasUnicos) {
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
            const sintomasStr = impactosUnicos.length
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
              const emoji: Record<string, string> = {
                performance: '💪', hipertrofia: '🏋️', emagrecimento: '🔥',
                recuperacao: '🩹', humor: '🧠'
              };
              return `<span style="background:#f0f9ff;color:#0284c7;padding:2px 6px;border-radius:4px;font-size:9px;margin-right:4px;display:inline-block">${emoji[k] || '📊'} ${k}: ${[...v].slice(0, 2).join(", ")}${v.size > 2 ? "..." : ""}</span>`;
            }).join("");
            const fitnessStr = fitnessTags ? `<div style="margin-top:4px">${fitnessTags}</div>` : "";

            const nomesItens = [...new Set(chunk.map(it => it.item))].join(", ");
            const htmlItens = `
              <div style="font-weight:800;color:${PDFConfig.colors.primary};font-size:11px;margin-bottom:3px">${escapeHtml(sistema)}</div>
              <div style="font-size:10px;color:#475569;margin-bottom:4px">${escapeHtml(nomesItens)}</div>
              ${sintomasStr}
              ${fitnessStr}
            `;

            const titulo = isFirstBlock
              ? `<div style="font-size:12px;font-weight:800;color:${PDFConfig.colors.primary};margin-bottom:8px">🔍 Mapa Técnico e Impacto Fitness</div>`
              : `<div style="font-size:10px;color:#64748b;margin-bottom:8px;font-style:italic">Mapa Técnico (continuação)</div>`;

            blocks.push(criarBlocoHTML(`${titulo}${htmlItens}`, { comBordaInferior: true }));
            isFirstBlock = false;
          }
        }
      }
    }

    onProgress?.(85, "Finalizando plano terapêutico...");

    // 7. PLANO TERAPÊUTICO
    if (data.plano_terapeutico?.terapias?.length) {
      const terapiasFiltradas = data.plano_terapeutico.terapias
        .filter(t => filtrarPorGenero(t.nome, data.pacienteGenero))
        .map(t => ({ ...t, nome: normalizarNomeItem(t.nome) }));

      if (terapiasFiltradas.length) {
        const TERAPIAS_POR_BLOCO = 4;
        for (let i = 0; i < terapiasFiltradas.length; i += TERAPIAS_POR_BLOCO) {
          const chunk = terapiasFiltradas.slice(i, i + TERAPIAS_POR_BLOCO);
          const htmlTerapias = chunk.map((t) => `
            <div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px dashed #e2e8f0">
              <div style="font-weight:700;color:${PDFConfig.colors.primary};font-size:11px">${escapeHtml(t.nome)}</div>
              <div style="font-size:10px;color:${PDFConfig.colors.info};margin:2px 0"><b>${escapeHtml(t.frequencia || "")}</b></div>
              <div style="color:#475569;font-size:10px">${escapeHtml(t.descricao || "")}</div>
              ${t.justificativa ? `<div style="font-size:9px;color:#64748b;margin-top:3px"><b>Por quê:</b> ${escapeHtml(t.justificativa)}</div>` : ""}
            </div>
          `).join("");

          const titulo = i === 0
            ? `<div style="font-size:12px;font-weight:800;color:${PDFConfig.colors.primary};margin-bottom:8px">🌿 Plano Terapêutico</div>`
            : `<div style="font-size:10px;color:#64748b;margin-bottom:8px;font-style:italic">Plano Terapêutico (cont.)</div>`;

          blocks.push(criarBlocoHTML(`${titulo}${htmlTerapias}`, {
            comBordaInferior: i < terapiasFiltradas.length - TERAPIAS_POR_BLOCO
          }));
        }
      }
    }

    // 8. FREQUÊNCIA + JUSTIFICATIVA
    const temInsônia = data.pontos_criticos?.some(p => isItemSono(p)) ||
      data.item_scores?.some(is => isItemSono(is.item) && is.score_atual < 50);
    const temEmocionalCritico = data.item_scores?.some(is => isItemEmocional(is.item) && is.score_atual < 50);

    const frequenciaTexto = data.frequencia_lunara && !/^[\s—\-–]+$/.test(data.frequencia_lunara)
      ? data.frequencia_lunara
      : temInsônia
        ? "🌙 Recomendação para Sono: 432Hz (ancoramento) + 528Hz (reparo) antes de dormir. Evitar telas 1h antes. Chá de camomila ou melissa."
        : temEmocionalCritico
          ? "💙 Recomendação Emocional: 417Hz (liberação) + 639Hz (conexão) durante meditação. Journaling e respiração consciente."
          : "Recomendação: Utilizar frequências Solfeggio (ex: 432Hz harmonização, 528Hz reparação) durante a sessão.";

    let htmlFrequenciaEJustificativa = `
      <div style="font-size:12px;font-weight:800;color:${PDFConfig.colors.primary};margin-bottom:6px">🎵 Frequência para Sessão</div>
      <div style="color:#334155;margin-bottom:12px;background:#f8fafc;padding:10px;border-radius:6px;border-left:4px solid ${temInsônia ? '#f59e0b' : temEmocionalCritico ? '#3b82f6' : '#8b5cf6'};font-size:11px">
        ${escapeHtml(frequenciaTexto)}
      </div>
    `;

    if (data.justificativa && !/^[\s—\-–]+$/.test(data.justificativa)) {
      htmlFrequenciaEJustificativa += `
        <div style="font-size:12px;font-weight:800;color:${PDFConfig.colors.primary};margin-bottom:6px">📝 Justificativa</div>
        <div style="color:#475569;font-size:11px;white-space:pre-line">${escapeHtml(data.justificativa)}</div>
      `;
    }

    blocks.push(criarBlocoHTML(htmlFrequenciaEJustificativa));

    // 9. RODAPÉ
    blocks.push(
      criarBlocoHTML(`
        <div style="text-align:center;font-size:9px;color:#94a3b8;padding-top:8px;border-top:1px solid #e2e8f0">
          Gerado por QRMA + BioSync • Lunara Terapias - Saúde Integrativa • ${new Date().getFullYear()}
        </div>
      `)
    );

    onProgress?.(90, "Renderizando PDF...");

    // =======================================================================
    // RENDERIZAÇÃO FINAL
    // =======================================================================
    blocks.forEach((b) => container.appendChild(b));
    document.body.appendChild(container);

    // ✅ Sem 'compress' — não é propriedade válida nas tipagens do jsPDF
    const pdf = new jsPDF({
      unit: "pt",
      format: "a4"
    });

    // ✅ CORREÇÃO 2: Removido 'creationDate' — não existe no tipo DocumentProperties
    if (includeMetadata) {
      pdf.setProperties({
        title: `Relatório BioSync - ${data.clientName}`,
        subject: "Relatório Terapêutico Integrativo",
        author: "BioSync System",
        creator: "QRMA + BioSync",
        keywords: "saúde, bioenergética, terapia, relatório",
      });
    }

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // ✅ CORREÇÃO 3: Tipar explicitamente como 'number' — sem isso o 'as const'
    //    do PDFConfig faz currentY ser inferido como literal '20', e quando
    //    recebe result.newY (number), o TS reclama: "number not assignable to 20"
    let currentY: number = PDFConfig.margin;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const progress = 90 + Math.round((i / blocks.length) * 8);
      onProgress?.(progress, `Renderizando bloco ${i + 1}/${blocks.length}...`);

      const canvas = await renderizarBlocoParaCanvas(block, PDFConfig.canvasScale);
      const result = adicionarBlocoAoPDF(pdf, canvas, currentY, {
        pageWidth,
        pageHeight,
        margin: PDFConfig.margin,
        footerHeight: PDFConfig.footerHeight,
      });
      currentY = result.newY;
    }

    onProgress?.(99, "Salvando arquivo...");

    // Gerar nome do arquivo seguro
    const safeName = (filename || data.clientName)
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase()
      .slice(0, 50) || "relatorio";

    const dateStr = formatDate(dataExibicao).replace(/\//g, "-").replace(/:/g, "-");
    const finalFilename = `biosync-${safeName}-${dateStr}.pdf`;

    pdf.save(finalFilename);

    onProgress?.(100, "PDF gerado com sucesso!");

  } catch (error: unknown) {
    console.error("❌ Erro ao gerar PDF:", error);

    if (error instanceof PDFGenerationError) {
      onError?.(error);
      alert(`Erro no relatório: ${error.message}\nCódigo: ${error.code}`);
    } else {
      const fallbackError = new PDFGenerationError(
        "Erro inesperado ao gerar o PDF",
        "UNKNOWN_ERROR",
        { originalError: error instanceof Error ? error.message : String(error) }
      );
      onError?.(fallbackError);
      alert("Erro ao gerar o PDF. Tente novamente ou contate o suporte.");
      throw fallbackError;
    }

  } finally {
    // ✅ CORREÇÃO 4: Renomeado para 'containerEl' — evita shadowing com
    //    a variável 'container' declarada no escopo do try
    const containerEl = document.querySelector<HTMLDivElement>('div[style*="left: -9999px"]');
    containerEl?.remove();
    escapeCache.clear();
  }
}