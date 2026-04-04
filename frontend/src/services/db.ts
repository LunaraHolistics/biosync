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
  resultado_json: any;
  analise_ia?: any;
  protocolo?: any;
  pontos_criticos?: string[];
  created_at: string;
};

// ==============================
// EXAMES (CORE DO SISTEMA)
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
    .gte("created_at", inicioMes);

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