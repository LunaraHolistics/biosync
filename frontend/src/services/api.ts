import {
  buscarAnalisePorHashECliente,
  buscarUltimaAnalisePorCliente,
  salvarNovaAnalise,
  type AnalysisRow,
} from "./db";

const API_URL = "https://biosync-e8ka.onrender.com";

export type AiStructuredData = {
  interpretacao: string;
  pontos_criticos: string[];
  protocolo: {
    manha: string[];
    tarde: string[];
    noite: string[];
  };
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

function normalizeAiData(input: unknown): AiStructuredData {
  const base: AiStructuredData = {
    interpretacao: "Não foi possível gerar análise completa.",
    pontos_criticos: [],
    protocolo: { manha: [], tarde: [], noite: [] },
    frequencia_lunara: "N/A",
    justificativa: "Erro na interpretação automática.",
  };

  if (!input || typeof input !== "object") return base;
  const obj = input as Record<string, unknown>;
  const protocoloRaw = obj.protocolo;
  const protocoloObj =
    protocoloRaw && typeof protocoloRaw === "object"
      ? (protocoloRaw as Record<string, unknown>)
      : {};

  return {
    interpretacao: toStringValue(obj.interpretacao, base.interpretacao),
    pontos_criticos: toStringArray(obj.pontos_criticos),
    protocolo: {
      manha: toStringArray(protocoloObj.manha),
      tarde: toStringArray(protocoloObj.tarde),
      noite: toStringArray(protocoloObj.noite),
    },
    frequencia_lunara: toStringValue(obj.frequencia_lunara, base.frequencia_lunara),
    justificativa: toStringValue(obj.justificativa, base.justificativa),
  };
}

function buildReusedResponse(existing: AnalysisRow): AiResponse {
  const raw = existing.result_text ?? "";
  let parsed: unknown = null;
  const candidate = extractJsonCandidate(raw);
  if (candidate) {
    try {
      parsed = JSON.parse(candidate);
    } catch {
      parsed = null;
    }
  }

  return {
    data: normalizeAiData(parsed),
    raw,
    dadosProcessados: existing.dados_processados,
    diagnostico: existing.diagnostico,
    comparacao: existing.comparacao,
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
    } catch {}
    throw new Error(message);
  }

  const payload = await res.json();

  return {
    data: normalizeAiData(payload.data), // ✅ CORREÇÃO AQUI
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
    } catch {}
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
    } catch {}
    throw new Error(message);
  }

  return res.json();
}

export async function processarPdf(
  files: File[],
  clientId: string,
): Promise<AiResponse> {
  if (!files || files.length === 0) {
    throw new Error("Nenhum arquivo enviado.");
  }

  // 🔥 HASH (usa o primeiro arquivo como referência)
  const fileHash = await gerarHashArquivo(files[0]);

  if (fileHash) {
    const existing = await buscarAnalisePorHashECliente(clientId, fileHash);
    if (existing) {
      return buildReusedResponse(existing);
    }
  }

  // 🔥 UPLOAD MULTIPLO
  const { textos } = await uploadPdf(files);

  if (!Array.isArray(textos) || textos.length === 0) {
    throw new Error("Nenhum conteúdo válido extraído dos arquivos.");
  }

  const pdf_hash = fileHash ?? "multi-upload";

  const existing = await buscarAnalisePorHashECliente(clientId, pdf_hash);
  if (existing) {
    return buildReusedResponse(existing);
  }

  const anterior = await buscarUltimaAnalisePorCliente(clientId);
  const anterior_dados_processados = anterior?.dados_processados ?? null;

  /**
   * 🔥 ENVIA ARRAY PRO BACKEND
   */
  const result = await gerarAnaliseSemIA(
    textos,
    anterior_dados_processados,
  );

  const { dadosProcessados, diagnostico, comparacao, protocolo } = result;

  const saved = await salvarNovaAnalise({
    client_id: clientId,
    raw_text: JSON.stringify(textos), // 🔥 salva array como string
    result_text: result.raw ?? "",
    ...(dadosProcessados !== undefined ? { dados_processados: dadosProcessados } : {}),
    ...(diagnostico !== undefined ? { diagnostico } : {}),
    ...(comparacao !== undefined ? { comparacao } : {}),
    ...(protocolo !== undefined ? { protocolo } : {}),
    pdf_hash,
  });

  return {
    ...result,
    reused: false,
    analysisId: saved.id,
  };
}
