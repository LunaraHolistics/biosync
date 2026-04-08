import {
  buscarUltimaAnalise,
  processarAnaliseCompleta,
  type AnaliseRow,
} from "./db";

import type {
  PlanoTerapeutico,
  PlanoTerapeuticoTipo,
  ItemPlanoTerapeutico,
} from "../types/planoTerapeutico";

// ==============================
// TIPOS
// ==============================

export type {
  PlanoTerapeutico,
  PlanoTerapeuticoTipo,
  ItemPlanoTerapeutico,
} from "../types/planoTerapeutico";

export type AiStructuredData = {
  interpretacao: string;
  pontos_criticos: string[];
  plano_terapeutico: PlanoTerapeutico;
  frequencia_lunara: string;
  justificativa: string;
};

export type AiResponse = {
  data: AiStructuredData;
  raw: string;
  impacto_fitness?: unknown;
  terapias?: unknown;
  reused: boolean;
  analysisId?: string;
};

// ==============================
// HELPERS
// ==============================

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x) => typeof x === "string");
  return [];
}

function toStringValue(value: unknown, def = ""): string {
  return typeof value === "string" ? value : def;
}

function isPlanoTipo(x: unknown): x is PlanoTerapeuticoTipo {
  return x === "semanal" || x === "quinzenal" || x === "mensal";
}

function defaultPlano(): PlanoTerapeutico {
  return { tipo: "mensal", terapias: [] };
}

// ==============================
// 🔥 NOVO PARSER (SEM MANHÃ/TARDE/NOITE)
// ==============================

export function parsePlanoTerapeutico(raw: unknown): PlanoTerapeutico {
  if (!raw || typeof raw !== "object") return defaultPlano();

  const o = raw as Record<string, unknown>;

  if (!isPlanoTipo(o.tipo)) return defaultPlano();
  if (!Array.isArray(o.terapias)) return defaultPlano();

  const terapias: ItemPlanoTerapeutico[] = o.terapias.map((t) => {
    const it = t as Record<string, unknown>;

    return {
      nome: toStringValue(it.nome, "Terapia"),
      descricao: toStringValue(it.descricao),
      frequencia: toStringValue(it.frequencia, "Conforme disponibilidade"),
      justificativa: toStringValue(it.justificativa),
    };
  });

  return {
    tipo: o.tipo,
    terapias,
  };
}

// ==============================
// 🔥 NORMALIZADOR PRINCIPAL
// ==============================

export function normalizeAnalise(
  analise: AnaliseRow
): AiStructuredData {
  const interpretacoes = analise.interpretacoes ?? [];

  const pontos = Array.isArray(interpretacoes)
    ? interpretacoes.map((i: any) => i.item).filter(Boolean)
    : [];

  const plano = parsePlanoTerapeutico({
    tipo: "mensal",
    terapias: (analise.terapias_recomendadas ?? []).map((t: any) => ({
      nome: t.nome,
      descricao: t.descricao,
      frequencia: t.frequencia_recomendada,
      justificativa: t.indicacoes,
    })),
  });

  return {
    interpretacao: "Análise baseada em dados fisiológicos e energéticos integrados.",
    pontos_criticos: pontos,
    plano_terapeutico: plano,
    frequencia_lunara: "Ajustada conforme padrão vibracional identificado.",
    justificativa: "As terapias foram selecionadas com base nos setores impactados e padrão de desequilíbrio.",
  };
}

// ==============================
// 🚀 NOVO CORE DO SISTEMA
// ==============================

export async function gerarAnaliseAtual(): Promise<AiResponse> {
  // 1. Processa no banco
  await processarAnaliseCompleta();

  // 2. Busca resultado
  const analise = await buscarUltimaAnalise();

  if (!analise) {
    throw new Error("Nenhuma análise encontrada.");
  }

  const data = normalizeAnalise(analise);

  return {
    data,
    raw: JSON.stringify(analise),
    impacto_fitness: analise.impacto_fitness,
    terapias: analise.terapias_recomendadas,
    reused: false,
    analysisId: analise.id,
  };
}

// ==============================
// 🔥 HISTÓRICO / REUSO
// ==============================

export function buildFromAnaliseExistente(
  analise: AnaliseRow
): AiResponse {
  return {
    data: normalizeAnalise(analise),
    raw: JSON.stringify(analise),
    impacto_fitness: analise.impacto_fitness,
    terapias: analise.terapias_recomendadas,
    reused: true,
    analysisId: analise.id,
  };
}