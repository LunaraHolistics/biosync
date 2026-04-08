// src/services/db.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Variáveis de ambiente do Supabase não configuradas!");
}

export const supabase = createClient(supabaseUrl!, supabaseKey!);

// ==============================
// TIPOS
// ==============================

export type ExameRow = {
  id: string;
  nome_paciente: string;
  data_exame: string;
  resultado_json: unknown;
  analise_ia?: unknown;
  protocolo?: unknown;
  pontos_criticos?: string[];
  created_at: string;
};

export type TerapiaRow = {
  id: string;
  nome: string;
  categoria: string | null;
  descricao: string | null;
  indicacoes: string | null;
  contraindicacoes?: string | null;
  frequencia_recomendada?: string | null;
  prioridade?: number;
  tags?: string[];
  setores_alvo?: string[];
  ativo?: boolean;
  created_at?: string;
};

export type AnaliseRow = {
  id: string;
  paciente_id?: string | null;
  itens_alterados: string[];
  interpretacoes?: any;
  terapias_recomendadas?: any;
  impacto_fitness?: any;
  score_geral?: number;
  html_relatorio?: string;
  created_at: string;
};

// ==============================
// TERAPIAS
// ==============================

export async function listarTerapias(): Promise<TerapiaRow[]> {
  const { data, error } = await supabase
    .from("terapias")
    .select("*")
    .eq("ativo", true)
    .order("prioridade", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as TerapiaRow[];
}

// ==============================
// EXAMES (LEGADO)
// ==============================

// Listar todos os exames
export async function listarExames(): Promise<ExameRow[]> {
  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .order("data_exame", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// Buscar por nome do paciente
export async function buscarExamesPorNome(
  termo: string
): Promise<ExameRow[]> {
  if (!termo.trim()) return await listarExames();

  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .ilike("nome_paciente", `%${termo}%`)
    .order("data_exame", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// Contar total de exames
export async function contarExames(): Promise<number> {
  const { count, error } = await supabase
    .from("exames")
    .select("*", { count: "exact", head: true });

  if (error) throw new Error(error.message);
  return count ?? 0;
}

// Contar exames do mês atual
export async function contarExamesMesAtual(): Promise<number> {
  const now = new Date();
  const inicioMes = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toISOString();

  const { count, error } = await supabase
    .from("exames")
    .select("*", { count: "exact", head: true })
    .gte("data_exame", inicioMes);

  if (error) throw new Error(error.message);
  return count ?? 0;
}

// Listar exames de um paciente específico
export async function listarExamesPorPaciente(
  nome: string
): Promise<ExameRow[]> {
  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .eq("nome_paciente", nome)
    .order("data_exame", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// Buscar exame por ID
export async function buscarExamePorId(
  id: string
): Promise<ExameRow | null> {
  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function buscarUltimoExamePorPaciente(
  nomePaciente: string
): Promise<ExameRow | null> {
  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .eq("nome_paciente", nomePaciente)
    .order("data_exame", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function buscarExamePorHashEPaciente(
  nomePaciente: string,
  pdfHash: string
): Promise<ExameRow | null> {
  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .eq("nome_paciente", nomePaciente)
    .contains("resultado_json", { pdf_hash: pdfHash })
    .order("data_exame", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export type NovoExamePayload = {
  nome_paciente: string;
  data_exame: string;
  resultado_json: Record<string, unknown>;
  analise_ia?: unknown;
  protocolo?: unknown;
  pontos_criticos?: string[];
};

export async function salvarNovoExame(
  payload: NovoExamePayload
): Promise<ExameRow> {
  const { data, error } = await supabase
    .from("exames")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as ExameRow;
}

// ==============================
// ANALISES (NOVO CORE)
// ==============================

// Buscar última análise
export async function buscarUltimaAnalise(): Promise<AnaliseRow | null> {
  const { data, error } = await supabase
    .from("analises")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

// Listar análises por paciente
export async function listarAnalisesPorPaciente(
  pacienteId: string
): Promise<AnaliseRow[]> {
  const { data, error } = await supabase
    .from("analises")
    .select("*")
    .eq("paciente_id", pacienteId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// Processar análise completa (RPC)
export async function processarAnaliseCompleta() {
  const { data, error } = await supabase.rpc("processar_analise_completa");

  if (error) throw new Error(error.message);
  return data;
}

// Atualizar análise manualmente
export async function atualizarAnalise(
  id: string,
  payload: Partial<AnaliseRow>
) {
  const { data, error } = await supabase
    .from("analises")
    .update(payload)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}