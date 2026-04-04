import {
  buscarExamePorHashEPaciente,
  buscarUltimoExamePorPaciente,
  salvarNovoExame,
  type ExameRow,
} from "./db";
import { gerarPlanoTerapeuticoSugerido } from "./terapiasEngine";
import type {
  PlanoTerapeutico,
  PlanoTerapeuticoTipo,
  ItemPlanoTerapeutico,
} from "../types/planoTerapeutico";

export type {
  PlanoTerapeutico,
  PlanoTerapeuticoTipo,
  ItemPlanoTerapeutico,
} from "../types/planoTerapeutico";

const API_URL = "https://biosync-e8ka.onrender.com";

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
  dadosProcessados?: unknown;
  diagnostico?: unknown;
  protocolo?: unknown;
  comparacao?: unknown;
  reused: boolean;
  analysisId?: string;
};

export type UploadResponse = {
  text: string;
  hash: string;
};

async function gerarHashArquivo(file: File): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const buffer = await file.arrayBuffer();
    const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] ?? null;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x) => typeof x === "string");
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  return [];
}

function toStringValue(value: unknown, defaultValue = ""): string {
  return typeof value === "string" ? value : defaultValue;
}

function isPlanoTerapeuticoTipo(x: unknown): x is PlanoTerapeuticoTipo {
  return x === "semanal" || x === "quinzenal" || x === "mensal";
}

function defaultPlano(): PlanoTerapeutico {
  return { tipo: "mensal", terapias: [] };
}

function legacyProtocoloPeriodosParaPlano(protocoloObj: Record<string, unknown>): PlanoTerapeutico {
  const m = toStringArray(protocoloObj.manha);
  const t = toStringArray(protocoloObj.tarde);
  const n = toStringArray(protocoloObj.noite);
  const terapias: ItemPlanoTerapeutico[] = [];
  for (const x of m) {
    terapias.push({
      nome: "Período manhã (registro anterior)",
      descricao: x,
      frequencia: "",
      justificativa: "Migrado de protocolo estruturado por período do dia.",
    });
  }
  for (const x of t) {
    terapias.push({
      nome: "Período tarde (registro anterior)",
      descricao: x,
      frequencia: "",
      justificativa: "Migrado de protocolo estruturado por período do dia.",
    });
  }
  for (const x of n) {
    terapias.push({
      nome: "Período noite (registro anterior)",
      descricao: x,
      frequencia: "",
      justificativa: "Migrado de protocolo estruturado por período do dia.",
    });
  }
  return { tipo: "mensal", terapias };
}

export function parsePlanoTerapeutico(raw: unknown): PlanoTerapeutico | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isPlanoTerapeuticoTipo(o.tipo)) return null;
  if (!Array.isArray(o.terapias)) return null;
  const terapias: ItemPlanoTerapeutico[] = [];
  for (const item of o.terapias) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    terapias.push({
      nome: toStringValue(it.nome, "—"),
      descricao: toStringValue(it.descricao),
      frequencia: toStringValue(it.frequencia),
      justificativa: toStringValue(it.justificativa),
    });
  }
  return { tipo: o.tipo, terapias };
}

export function normalizeAiData(input: unknown): AiStructuredData {
  const base: AiStructuredData = {
    interpretacao: "Não foi possível gerar análise completa.",
    pontos_criticos: [],
    plano_terapeutico: defaultPlano(),
    frequencia_lunara: "N/A",
    justificativa: "Erro na interpretação automática.",
  };

  if (!input || typeof input !== "object") return base;
  const obj = input as Record<string, unknown>;

  let plano = parsePlanoTerapeutico(obj.plano_terapeutico);
  if (!plano && obj.protocolo && typeof obj.protocolo === "object") {
    const po = obj.protocolo as Record<string, unknown>;
    if ("manha" in po || "tarde" in po || "noite" in po) {
      plano = legacyProtocoloPeriodosParaPlano(po);
    } else {
      plano = parsePlanoTerapeutico(obj.protocolo);
    }
  }
  if (!plano) plano = defaultPlano();

  return {
    interpretacao: toStringValue(obj.interpretacao, base.interpretacao),
    pontos_criticos: toStringArray(obj.pontos_criticos),
    plano_terapeutico: plano,
    frequencia_lunara: toStringValue(obj.frequencia_lunara, base.frequencia_lunara),
    justificativa: toStringValue(obj.justificativa, base.justificativa),
  };
}

function buildReusedResponse(existing: ExameRow): AiResponse {
  let parsed: unknown = existing.analise_ia;
  if (typeof existing.analise_ia === "string") {
    const candidate = extractJsonCandidate(existing.analise_ia);
    if (candidate) {
      try {
        parsed = JSON.parse(candidate);
      } catch {
        parsed = null;
      }
    } else {
      parsed = null;
    }
  }

  const rj =
    existing.resultado_json && typeof existing.resultado_json === "object"
      ? (existing.resultado_json as Record<string, unknown>)
      : {};

  const raw =
    typeof existing.analise_ia === "string"
      ? existing.analise_ia
      : JSON.stringify(existing.analise_ia ?? {});

  let data = normalizeAiData(parsed);
  const planoRj = parsePlanoTerapeutico(rj.plano_terapeutico);
  const planoProt = parsePlanoTerapeutico(existing.protocolo);
  if (planoRj && planoRj.terapias.length > 0) {
    data = { ...data, plano_terapeutico: planoRj };
  } else if (planoProt && planoProt.terapias.length > 0) {
    data = { ...data, plano_terapeutico: planoProt };
  }

  return {
    data,
    raw,
    dadosProcessados: rj.dados_processados ?? existing.resultado_json,
    diagnostico: rj.diagnostico,
    comparacao: rj.comparacao,
    protocolo: existing.protocolo,
    reused: true,
    analysisId: existing.id,
  };
}

/**
 * 🔥 NOVO: endpoint sem IA (usa banco / regras)
 */
export async function gerarAnaliseSemIA(
  prompt: string | string[],
  anterior_dados_processados?: unknown,
): Promise<AiResponse> {
  const res = await fetch(`${API_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      anterior_dados_processados,
    }),
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* ignore JSON parse errors */
    }
    throw new Error(message);
  }

  const payload = await res.json();

  return {
    data: normalizeAiData(payload.data),
    raw: payload.raw ?? JSON.stringify(payload.data),
    dadosProcessados: payload.dadosProcessados,
    diagnostico: payload.diagnostico,
    protocolo: payload.protocolo,
    comparacao: payload.comparacao,
    reused: payload.reused ?? false,
  };
}

/**
 * ⚠️ MANTIDO: IA (fallback opcional)
 */
export async function gerarAnalise(
  prompt: string,
  comparacao?: unknown,
  anterior_dados_processados?: unknown,
): Promise<AiResponse> {
  const res = await fetch(`${API_URL}/api/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, comparacao, anterior_dados_processados }),
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* ignore JSON parse errors */
    }
    throw new Error(message);
  }

  const payload = (await res.json()) as Omit<AiResponse, "reused"> & { reused?: boolean };
  return { ...payload, reused: payload.reused ?? false };
}

export async function uploadPdf(files: File[]): Promise<{ textos: string[] }> {
  const form = new FormData();

  files.forEach((f) => form.append("files", f));

  const res = await fetch(`${API_URL}/api/upload`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      /* ignore JSON parse errors */
    }
    throw new Error(message);
  }

  return res.json();
}

export async function processarPdf(
  files: File[],
  nomePaciente: string,
): Promise<AiResponse> {
  if (!files || files.length === 0) {
    throw new Error("Nenhum arquivo enviado.");
  }

  const nome = nomePaciente.trim();
  if (!nome) {
    throw new Error("Informe o nome do paciente.");
  }

  const fileHash = await gerarHashArquivo(files[0]);

  if (fileHash) {
    const existing = await buscarExamePorHashEPaciente(nome, fileHash);
    if (existing) {
      return buildReusedResponse(existing);
    }
  }

  const { textos } = await uploadPdf(files);

  if (!Array.isArray(textos) || textos.length === 0) {
    throw new Error("Nenhum conteúdo válido extraído dos arquivos.");
  }

  const pdf_hash = fileHash ?? "multi-upload";

  const existing = await buscarExamePorHashEPaciente(nome, pdf_hash);
  if (existing) {
    return buildReusedResponse(existing);
  }

  const anterior = await buscarUltimoExamePorPaciente(nome);
  const anterior_dados_processados =
    anterior?.resultado_json &&
    typeof anterior.resultado_json === "object" &&
    (anterior.resultado_json as Record<string, unknown>).dados_processados !== undefined
      ? (anterior.resultado_json as Record<string, unknown>).dados_processados
      : anterior?.resultado_json ?? null;

  const result = await gerarAnaliseSemIA(textos, anterior_dados_processados ?? undefined);

  const { dadosProcessados, diagnostico, comparacao } = result;

  let plano: PlanoTerapeutico;
  try {
    plano = await gerarPlanoTerapeuticoSugerido(
      normalizeAiData(result.data).pontos_criticos,
      diagnostico,
    );
  } catch {
    plano = { tipo: "mensal", terapias: [] };
  }

  const dataFinal: AiStructuredData = {
    ...normalizeAiData(result.data),
    plano_terapeutico: plano,
  };

  const resultado_json: Record<string, unknown> = {
    pdf_hash,
    dados_processados: dadosProcessados ?? null,
    ...(diagnostico !== undefined ? { diagnostico } : {}),
    ...(comparacao !== undefined ? { comparacao } : {}),
    plano_terapeutico: plano,
    raw_textos: textos,
  };

  const saved = await salvarNovoExame({
    nome_paciente: nome,
    data_exame: new Date().toISOString(),
    resultado_json,
    analise_ia: dataFinal,
    protocolo: plano,
    pontos_criticos: dataFinal.pontos_criticos,
  });

  return {
    ...result,
    data: dataFinal,
    reused: false,
    analysisId: saved.id,
  };
}
