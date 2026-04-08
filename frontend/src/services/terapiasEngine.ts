import type {
  PlanoTerapeutico,
  PlanoTerapeuticoTipo,
  ItemPlanoTerapeutico,
} from "../types/planoTerapeutico";
import type { TerapiaRow } from "./db";
import { listarTerapias } from "./db";

// ==============================
// NORMALIZAÇÃO
// ==============================

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function indicacoesParaTexto(indicacoes: unknown): string {
  if (indicacoes == null) return "";
  if (typeof indicacoes === "string") return indicacoes;
  if (Array.isArray(indicacoes)) {
    return indicacoes.filter((x) => typeof x === "string").join(", ");
  }
  if (typeof indicacoes === "object") {
    return JSON.stringify(indicacoes);
  }
  return String(indicacoes);
}

// ==============================
// CONTEXTO INTELIGENTE
// ==============================

function tokenizarContexto(
  pontos: string[],
  diagnostico: unknown,
): { texto: string; tokens: Set<string> } {
  const partes: string[] = [...pontos];

  const d = diagnostico as {
    problemas?: { sistema?: string; item?: string; impacto?: string }[];
  } | null;

  if (d?.problemas) {
    for (const p of d.problemas) {
      if (p.sistema) partes.push(p.sistema);
      if (p.item) partes.push(p.item);
      if (p.impacto) partes.push(p.impacto);
    }
  }

  const texto = partes.join(" ");
  const raw = normalizeText(texto).split(/[^a-z0-9à-ÿ]+/i);

  const tokens = new Set(raw.filter((w) => w.length > 2));

  return {
    texto: normalizeText(texto),
    tokens,
  };
}

// ==============================
// SCORE INTELIGENTE DE TERAPIA
// ==============================

function pontuacaoTerapia(
  t: TerapiaRow,
  contextoNorm: string,
  tokens: Set<string>,
): number {
  const ind = normalizeText(indicacoesParaTexto(t.indicacoes));
  const desc = normalizeText(t.descricao ?? "");
  const nome = normalizeText(t.nome ?? "");
  const cat = normalizeText(t.categoria ?? "");

  const haystack = `${ind} ${desc} ${nome} ${cat}`;

  let score = 0;

  // Match por tokens
  for (const tok of tokens) {
    if (tok.length < 3) continue;
    if (haystack.includes(tok)) score += 3;
  }

  // Peso por nome da terapia
  const palavrasNome = nome.split(/\s+/).filter((w) => w.length > 3);
  for (const w of palavrasNome) {
    if (contextoNorm.includes(w)) score += 2;
  }

  // 🔥 BOOST FITNESS (novo)
  if (
    contextoNorm.includes("fadiga") ||
    contextoNorm.includes("muscular") ||
    contextoNorm.includes("energia") ||
    contextoNorm.includes("recuperacao")
  ) {
    if (haystack.includes("energia") || haystack.includes("fisico")) {
      score += 2;
    }
  }

  return score;
}

// ==============================
// DEFINIÇÃO DO TIPO DE PLANO
// ==============================

export function inferirTipoPlano(
  diagnostico: unknown,
  pontos_criticos: string[],
): PlanoTerapeuticoTipo {
  const d = diagnostico as { problemas?: { score?: number }[] } | undefined;

  let severos = 0;
  let moderados = 0;

  if (d?.problemas) {
    for (const p of d.problemas) {
      const s = typeof p.score === "number" ? p.score : 0;

      if (s > 50) severos++;
      else if (s > 20) moderados++;
    }
  }

  const nCrit = pontos_criticos.length;

  if (severos >= 1 || nCrit >= 8) return "semanal";
  if (severos + moderados >= 3 || nCrit >= 4) return "quinzenal";

  return "mensal";
}

// ==============================
// FREQUÊNCIA INTELIGENTE (SEM MANHÃ/TARDE/NOITE)
// ==============================

function frequenciaPadraoItem(
  tipo: PlanoTerapeuticoTipo,
  frequencia_base?: string | null,
): string {
  if (frequencia_base && frequencia_base.trim()) {
    return frequencia_base;
  }

  if (tipo === "semanal") return "1 a 2 sessões por semana";
  if (tipo === "quinzenal") return "1 sessão a cada 7–15 dias";

  return "1 sessão mensal de manutenção";
}

// ==============================
// JUSTIFICATIVA TERAPÊUTICA
// ==============================

function montarJustificativa(
  t: TerapiaRow,
  pontos: string[],
): string {
  const indic = indicacoesParaTexto(t.indicacoes).slice(0, 220);
  const ponto = pontos[0] ?? "contexto energético identificado";

  return `Atua diretamente sobre ${ponto}. Indicações terapêuticas incluem: ${
    indic || "equilíbrio geral"
  }.`;
}

// ==============================
// RANQUEAMENTO FINAL
// ==============================

export function rankearTerapias(
  catalogo: TerapiaRow[],
  pontos_criticos: string[],
  diagnostico: unknown,
  limite = 8,
): TerapiaRow[] {
  const { texto, tokens } = tokenizarContexto(pontos_criticos, diagnostico);

  const scored = catalogo.map((t) => ({
    terapia: t,
    score: pontuacaoTerapia(t, texto, tokens),
  }));

  scored.sort((a, b) => b.score - a.score);

  const comMatch = scored.filter((x) => x.score > 0);

  if (comMatch.length > 0) {
    return comMatch.slice(0, limite).map((x) => x.terapia);
  }

  return catalogo.slice(0, Math.min(limite, 3));
}

// ==============================
// MONTAGEM DO PLANO FINAL
// ==============================

export function montarPlanoTerapeutico(
  tipo: PlanoTerapeuticoTipo,
  terapias: TerapiaRow[],
  pontos_criticos: string[],
): PlanoTerapeutico {
  const itens: ItemPlanoTerapeutico[] = terapias.map((t) => ({
    nome: t.nome_terapia,
    descricao: t.descricao ?? "",
    frequencia: frequenciaPadraoItem(tipo, t.frequencia),
    justificativa: montarJustificativa(t, pontos_criticos),
  }));

  return {
    tipo,
    terapias: itens,
  };
}

// ==============================
// ORQUESTRADOR PRINCIPAL
// ==============================

export async function gerarPlanoTerapeuticoSugerido(
  pontos_criticos: string[],
  diagnostico: unknown,
): Promise<PlanoTerapeutico> {
  const catalogo = await listarTerapias();

  const tipo = inferirTipoPlano(diagnostico, pontos_criticos);

  const terapiasRankeadas = rankearTerapias(
    catalogo,
    pontos_criticos,
    diagnostico,
    8,
  );

  return montarPlanoTerapeutico(
    tipo,
    terapiasRankeadas,
    pontos_criticos,
  );
}