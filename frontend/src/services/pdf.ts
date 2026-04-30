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
// =======================================================================

export class PDFGenerationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PDFGenerationError";
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
      removeContainer: true, // Libera memória automaticamente
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
    .replace(/[:：]$/, "") // Remove dois pontos no final
    .replace(/\s+/g, " ") // Normaliza espaços múltiplos
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
  // Sono e relaxamento
  "Magnésio": {
    titulo: "Magnésio (Relaxamento e Sono)",
    explicacao: "O magnésio é essencial para o relaxamento muscular, produção de melatonina e regulação do sistema nervoso. Deficiência causa insônia, ansiedade, tensão muscular, cãibras e fadiga crônica.",
    recomendacao: "Suplementação com magnésio quelado (300-400mg/dia), alimentos ricos (castanhas, espinafre, abacate), banhos de sal grosso, evitar café após 14h."
  },
  "Triptofano": {
    titulo: "Triptofano",
    explicacao: "Aminoácido precursor da serotonina e melatonina. Essencial para indução e qualidade do sono. Baixos níveis causam insônia, depressão e ansiedade.",
    recomendacao: "Alimentos ricos (banana, aveia, leite, peru, castanhas), suplementação (500-1000mg antes de dormir), evitar proteínas pesadas à noite."
  },
  "Fadiga visual": {
    titulo: "Fadiga Visual",
    explicacao: "Cansaço mental e ocular que prejudica o ciclo sono-vigília. Excesso de telas, luz azul e esforço visual constante ativam o sistema nervoso simpático, dificultando o relaxamento noturno.",
    recomendacao: "Regra 20-20-20 (a cada 20min, olhar 20 pés por 20 seg), filtro de luz azul após 18h, óleos essenciais de lavanda, pausas ativas."
  },
  "Equilíbrio Hepático": {
    titulo: "Equilíbrio Hepático (Metabolismo e Sono)",
    explicacao: "Fígado sobrecarregado prejudica desintoxicação noturna, metabolismo de hormônios e produção de bile. Sono entre 23h-3h é crucial para regeneração hepática.",
    recomendacao: "Evitar álcool e alimentos processados, chás digestivos (boldo, carqueja), jantar leve até 19h, dormir antes de 23h."
  },
  // Emoções
  "Amor": {
    titulo: "Amor (Nível de Consciência)",
    explicacao: "Estado emocional de conexão, compaixão e aceitação. Score baixo indica bloqueios emocionais, dificuldade em se conectar ou ressentimentos não resolvidos.",
    recomendacao: "Práticas de gratidão, terapia de perdão, meditação do coração, journaling emocional, flores de Bach (Walnut, Holly)."
  },
  "Medo": {
    titulo: "Medo (Nível de Consciência)",
    explicacao: "Emoção de proteção que, em excesso, paralisa e limita. Score baixo indica ansiedade generalizada, fobias ou insegurança crônica.",
    recomendacao: "Exposição gradual, técnicas de grounding, florais de Bach (Mimulus, Rock Rose), suplementação com magnésio e L-teanina."
  },
  // Minerais
  "Potássio": {
    titulo: "Potássio",
    explicacao: "Mineral essencial para função muscular, nervosa e equilíbrio eletrolítico. Deficiência causa cãibras, fadiga, arritmias e sono fragmentado.",
    recomendacao: "Alimentos ricos (banana, batata-doce, abacate, espinafre, feijão), evitar diuréticos em excesso."
  },
  // Saúde geral
  "Metais Pesados": {
    titulo: "Metais Pesados",
    explicacao: "Acúmulo de chumbo, mercúrio, cádmio e alumínio causa toxicidade sistêmica, fadiga crônica, névoa mental e distúrbios do sono.",
    recomendacao: "Desintoxicação com coentro, chlorella, zeolita, sauna, evitar peixes contaminados, panelas de alumínio."
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

    // ✅ Correção 1: Remover 'compress' que não é opção válida no jsPDF
    const pdf = new jsPDF({
      unit: "pt",
      format: "a4"
      // compress: true  ← REMOVIDO: não é propriedade válida nas definições de tipo
    });

    // Adicionar metadados se solicitado
    if (includeMetadata) {
      // ✅ Correção 2: creationDate deve ser string no formato esperado ou omitido
      pdf.setProperties({
        title: `Relatório BioSync - ${data.clientName}`,
        subject: "Relatório Terapêutico Integrativo",
        author: "BioSync System",
        creator: "QRMA + BioSync",
        keywords: "saúde, bioenergética, terapia, relatório",
        // ✅ Correção: usar string ISO ou remover se causar conflito de tipo
        creationDate: new Date(dataExibicao).toISOString(),
      });
    }

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    let currentY = PDFConfig.margin;

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

  } catch (error: unknown) { // ✅ Correção 3: tipar error como unknown para type safety
    console.error("❌ Erro ao gerar PDF:", error);

    // ✅ Correção 4: garantir que apenas PDFGenerationError seja passado para onError
    if (error instanceof PDFGenerationError) {
      onError?.(error);
      alert(`Erro no relatório: ${error.message}\nCódigo: ${error.code}`);
    } else {
      const fallbackError = new PDFGenerationError(
        "Erro inesperado ao gerar o PDF",
        "UNKNOWN_ERROR",
        { originalError: error instanceof Error ? error.message : String(error) }
      );
      onError?.(fallbackError); // ✅ onError recebe apenas PDFGenerationError
      alert("Erro ao gerar o PDF. Tente novamente ou contate o suporte.");

      // ✅ Correção 5: throw o erro tratado, não o original
      throw fallbackError;
    }

  } finally {
    // Cleanup garantido
    // ✅ Correção 6: seleção mais segura do container
    const container = document.querySelector<HTMLDivElement>('div[style*="left: -9999px"]');
    container?.remove();
    escapeCache.clear(); // Limpar cache para evitar memory leak em sessões longas
  }

    // =======================================================================
    // 🔥 EXPORTAÇÕES PARA TESTES
    // =======================================================================
  
    if (typeof window !== "undefined") {
      (window as any).PDFUtils = {
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
  }