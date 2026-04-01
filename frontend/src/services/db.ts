import { supabase } from "../lib/supabase";

export type ClientRow = {
  id: string;
  name: string;
  created_at: string;
};

export type AnalysisRow = {
  id: string;
  client_id: string;
  raw_text: string;
  result_text: string;
  created_at: string;
  diagnostico?: unknown;
  dados_processados?: unknown;
  pdf_hash?: string;
  comparacao?: unknown;
};

// Payload used when creating a row in `analyses`.
// `dados_processados` is optional for backwards/forwards compatibility.
export type NewAnalysis = Pick<AnalysisRow, "client_id" | "raw_text" | "result_text"> & {
  dados_processados?: unknown;
  diagnostico?: unknown;
  pdf_hash?: string;
  comparacao?: unknown;
};

export async function criarCliente(name: string): Promise<ClientRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Nome do cliente é obrigatório");

  const { data, error } = await supabase
    .from("clients")
    .insert({ name: trimmed })
    .select("*")
    .single();

  if (error) throw error;
  return data as ClientRow;
}

async function buscarClientesPorNomeInternal(
  query: string,
  limit = 10,
): Promise<ClientRow[]> {
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await supabase
    .from("clients")
    .select("id,name,created_at")
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as ClientRow[];
}

export async function buscarClientesPorNome(nome: string): Promise<ClientRow[]> {
  return await buscarClientesPorNomeInternal(nome, 10);
}

export async function listarClientes(limit = 200): Promise<ClientRow[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("id,name,created_at")
    .order("name", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as ClientRow[];
}

export async function listarAnalisesPorClientId(
  clientId: string,
  limit = 50,
): Promise<AnalysisRow[]> {
  const { data, error } = await supabase
    .from("analyses")
    .select("id,client_id,raw_text,result_text,created_at,diagnostico,dados_processados,pdf_hash,comparacao")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as AnalysisRow[];
}

export async function listarAnalises(clientId: string): Promise<AnalysisRow[]> {
  const { data, error } = await supabase
    .from("analyses")
    .select("id,client_id,raw_text,result_text,created_at,diagnostico,dados_processados,pdf_hash,comparacao")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []) as AnalysisRow[];
}

export async function salvarNovaAnalise(payload: NewAnalysis): Promise<AnalysisRow> {
  const insertPayload = {
    client_id: payload.client_id,
    raw_text: payload.raw_text,
    result_text: payload.result_text,
    ...(payload.dados_processados !== undefined
      ? { dados_processados: payload.dados_processados }
      : {}),
    ...(payload.diagnostico !== undefined ? { diagnostico: payload.diagnostico } : {}),
    ...(payload.pdf_hash !== undefined ? { pdf_hash: payload.pdf_hash } : {}),
    ...(payload.comparacao !== undefined ? { comparacao: payload.comparacao } : {}),
  };

  const { data, error } = await supabase
    .from("analyses")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    // When UNIQUE(client_id, pdf_hash) is in place, concurrent inserts can race.
    // Treat duplicate insert as "reused" by fetching the existing analysis.
    const code = (error as any)?.code as string | undefined;
    if (code === "23505" && payload.pdf_hash) {
      const existing = await buscarAnalisePorHashECliente(payload.client_id, payload.pdf_hash);
      if (existing) return existing;
    }
    throw error;
  }
  return data as AnalysisRow;
}

export async function buscarUltimaAnalisePorCliente(
  clientId: string,
): Promise<AnalysisRow | null> {
  const { data, error } = await supabase
    .from("analyses")
    .select("id,client_id,raw_text,result_text,created_at,diagnostico,dados_processados,pdf_hash,comparacao")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as AnalysisRow | null) ?? null;
}

export async function buscarAnalisePorHashECliente(
  clientId: string,
  pdfHash: string,
): Promise<AnalysisRow | null> {
  const { data, error } = await supabase
    .from("analyses")
    .select("id,client_id,raw_text,result_text,created_at,diagnostico,dados_processados,pdf_hash,comparacao")
    .eq("client_id", clientId)
    .eq("pdf_hash", pdfHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as AnalysisRow | null) ?? null;
}

export async function contarClientes(): Promise<number> {
  const { count, error } = await supabase
    .from("clients")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function contarAnalises(): Promise<number> {
  const { count, error } = await supabase
    .from("analyses")
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function contarAnalisesMesAtual(): Promise<number> {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const { count, error } = await supabase
    .from("analyses")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString());

  if (error) throw error;
  return count ?? 0;
}

