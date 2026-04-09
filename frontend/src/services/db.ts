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
  resultado_json: Record<string, any>;
  analise_ia?: Record<string, any>;
  protocolo?: string | null;
  pontos_criticos?: string[];
  created_at: string;
  updated_at?: string;

  // 🔥 NOVO MODELO
  status?: string;
  indice_biosync?: Record<string, any>;

  total_pioraram?: number;
  total_melhoraram?: number;
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

export type BaseAnaliseSaudeRow = {
  id: number;
  categoria: string;
  item: string;
  descricao_tecnica: string;
  descricao_paciente?: string | null;
  impacto?: string | null;
  setores?: string[];
  palavras_chave?: string[];
  sistemas_relacionados?: string[];
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
// BASE DE CONHECIMENTO (🔥 NOVO)
// ==============================

export async function listarBaseAnaliseSaude(): Promise<BaseAnaliseSaudeRow[]> {
  const { data, error } = await supabase
    .from("base_analise_saude")
    .select("*");

  if (error) throw new Error(error.message);
  return (data ?? []) as BaseAnaliseSaudeRow[];
}

// buscar itens específicos pelo nome (match com exame)
export async function buscarItensBasePorNome(
  nomes: string[]
): Promise<BaseAnaliseSaudeRow[]> {
  if (!nomes.length) return [];

  const { data, error } = await supabase
    .from("base_analise_saude")
    .select("*")
    .in("item", nomes);

  if (error) throw new Error(error.message);
  return (data ?? []) as BaseAnaliseSaudeRow[];
}

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
// EXAMES
// ==============================

export async function listarExames(): Promise<ExameRow[]> {
  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .order("data_exame", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ExameRow[];
}

export async function buscarExamesPorNome(
  termo: string
): Promise<ExameRow[]> {
  if (!termo.trim()) return listarExames();

  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .ilike("nome_paciente", `%${termo}%`)
    .order("data_exame", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ExameRow[];
}

export async function listarExamesPorPaciente(
  nome: string
): Promise<ExameRow[]> {
  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .eq("nome_paciente", nome)
    .order("data_exame", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ExameRow[];
}

export async function buscarExamePorId(
  id: string
): Promise<ExameRow | null> {
  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as ExameRow | null;
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
  return data as ExameRow | null;
}

// ==============================
// INSERÇÃO
// ==============================

export type NovoExamePayload = {
  nome_paciente: string;
  data_exame: string;
  resultado_json: Record<string, any>;
  analise_ia?: Record<string, any>;
  protocolo?: string;
  pontos_criticos?: string[];

  indice_biosync?: Record<string, any>;
  status?: string;
  total_pioraram?: number;
  total_melhoraram?: number;
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
// ANALISES (CORE FUTURO)
// ==============================

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

export async function processarAnaliseCompleta() {
  const { data, error } = await supabase.rpc(
    "processar_analise_completa"
  );

  if (error) throw new Error(error.message);
  return data;
}

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