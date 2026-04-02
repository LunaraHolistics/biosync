// src/services/db.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Variáveis de ambiente do Supabase não configuradas!");
}

export const supabase = createClient(supabaseUrl!, supabaseKey!);

// --- TIPOS ---
export type ClientRow = {
  id: string;
  name: string;
  created_at: string;
};

export type AnalysisRow = {
  id: string;
  client_id: string;
  result_text: string | null;
  diagnostico: any;
  dados_processados: any;
  comparacao: any;
  hash: string | null;
  created_at: string;
};

// --- FUNÇÕES DE CLIENTE ---

export async function listarClientes(): Promise<ClientRow[]> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function buscarClientesPorNome(termo: string): Promise<ClientRow[]> {
  if (!termo.trim()) return await listarClientes();
  
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .ilike("name", `%${termo}%`)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function contarClientes(): Promise<number> {
  const { count, error } = await supabase
    .from("clients")
    .select("*", { count: "exact", head: true });

  if (error) throw new Error(error.message);
  return count ?? 0;
}

// --- FUNÇÕES DE ANÁLISE ---

export async function listarAnalises(clientId: string): Promise<AnalysisRow[]> {
  const { data, error } = await supabase
    .from("analyses")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function contarAnalises(): Promise<number> {
  const { count, error } = await supabase
    .from("analyses")
    .select("*", { count: "exact", head: true });

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function contarAnalisesMesAtual(): Promise<number> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { count, error } = await supabase
    .from("analyses")
    .select("*", { count: "exact", head: true })
    .gte("created_at", startOfMonth);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function buscarAnalisePorHashECliente(
  hash: string,
  clientId: string
): Promise<AnalysisRow | null> {
  const { data, error } = await supabase
    .from("analyses")
    .select("*")
    .eq("hash", hash)
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function buscarUltimaAnalisePorCliente(
  clientId: string
): Promise<AnalysisRow | null> {
  const { data, error } = await supabase
    .from("analyses")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function salvarNovaAnalise(payload: {
  client_id: string;
  result_text: string;
  diagnostico: any;
  dados_processados: any;
  comparacao: any;
  hash: string;
}): Promise<AnalysisRow> {
  const { data, error } = await supabase
    .from("analyses")
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}