import { supabase } from '../config/supabase';
import {
  ExameSchema,
  TerapiaSchema,
  BaseAnaliseSchema,
} from "../validators/exameValidator";

// ✅ REMOVIDO: Não recriar o cliente, já vem do config
// const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
// const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
// if (!supabaseUrl || !supabaseKey) { ... }
// export const supabase = createClient(...); // ← ESTA LINHA CAUSAVA O CONFLITO

// ==============================
// TIPOS
// ==============================

export type ExameRow = {
  id: string;
  nome_paciente: string;
  data_exame: string;
  created_at: string;
  updated_at?: string;

  resultado_json?: Record<string, unknown> | unknown[] | null;
  indice_biosync?: Record<string, unknown> | null;
  analise_ia?: Record<string, any>;

  protocolo?: string | null;
  pontos_criticos?: string[];
  status?: string;

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
// BASE DE CONHECIMENTO
// ==============================

export async function listarBaseAnaliseSaude(): Promise<BaseAnaliseSaudeRow[]> {
  const { data, error } = await supabase
    .from("base_analise_saude")
    .select("*");

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((b) => {
      const parsed = BaseAnaliseSchema.safeParse(b);
      if (!parsed.success) {
        console.warn("Erro base análise:", parsed.error);
        return null;
      }
      return parsed.data;
    })
    .filter(Boolean) as BaseAnaliseSaudeRow[];
}

export async function buscarItensBasePorNome(
  nomes: string[]
): Promise<BaseAnaliseSaudeRow[]> {
  if (!nomes.length) return [];

  const { data, error } = await supabase
    .from("base_analise_saude")
    .select("*")
    .in("item", nomes);

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((b) => {
      const parsed = BaseAnaliseSchema.safeParse(b);
      if (!parsed.success) return null;
      return parsed.data;
    })
    .filter(Boolean) as BaseAnaliseSaudeRow[];
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

  return (data ?? [])
    .map((t) => {
      const parsed = TerapiaSchema.safeParse(t);
      if (!parsed.success) {
        console.warn("Erro terapia:", parsed.error);
        return null;
      }
      return parsed.data;
    })
    .filter(Boolean) as TerapiaRow[];
}

// ==============================
// EXAMES
// ==============================

function validarExameLista(data: any[]): ExameRow[] {
  return (data ?? [])
    .map((e) => {
      const parsed = ExameSchema.safeParse(e);
      if (!parsed.success) {
        console.warn("Erro exame:", parsed.error);
        return null;
      }
      return parsed.data;
    })
    .filter(Boolean) as ExameRow[];
}

export async function listarExames(): Promise<ExameRow[]> {
  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .order("data_exame", { ascending: false });

  if (error) throw new Error(error.message);
  return validarExameLista(data ?? []);
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
  return validarExameLista(data ?? []);
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
  return validarExameLista(data ?? []);
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

  if (!data) return null;

  const parsed = ExameSchema.safeParse(data);
  if (!parsed.success) {
    console.warn("Erro exame:", parsed.error);
    return null;
  }

  return parsed.data;
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

  if (!data) return null;

  const parsed = ExameSchema.safeParse(data);
  if (!parsed.success) return null;

  return parsed.data;
}

// ==============================
// SALVAR ANÁLISE CURADA NO SUPABASE
// ==============================

export async function salvarAnaliseCurada(
  exameId: string,
  analise: any // Usamos any aqui porque vindo do motor é um objeto complexo
): Promise<boolean> {
  try {
    // Prepara os dados no formato exato que o banco espera
    const payload = {
      exame_id: exameId,
      score_geral: analise.scoreGeral,
      status_score: analise.statusScore,
      interpretacao: analise.interpretacao,
      pontos_criticos: analise.pontosCriticos,
      setores_afetados: analise.setoresAfetados,
      resumo_categorias: analise.resumoCategorias,
      frequencia_solfeggio: analise.frequencia_lunara || "",
      justificativa: `Score: ${analise.scoreGeral}/100 — ${analise.statusScore}. Setores: ${(analise.setoresAfetados || []).join(", ")}.`,
      terapias_sugeridas: analise.terapias.map((t: any) => ({
        nome: t.nome,
        descricao: t.descricao,
        frequencia: t.frequencia || (t as any).frequencia_recomendada || "",
        justificativa: t.motivos?.join(", ") || "",
        scoreRelevancia: t.scoreRelevancia
      })),
      impacto_fitness: (analise.matches || []).map((m: any) => ({
        categoria: m.categoria,
        item: m.itemBase,
        gravidade: m.gravidade,
        impacto: m.impacto,
        impacto_fitness: (m as any).impacto_fitness || null
      }))
    };

    const { error } = await supabase
      .from('analises_curadas')
      .upsert(payload, { onConflict: 'exame_id' });

    if (error) {
      console.error("Erro ao salvar análise curada:", error.message);
      return false;
    }
    
    return true;
  } catch (err) {
    console.error("Erro inesperado ao salvar curada:", err);
    return false;
  }
}

export async function buscarAnaliseCurada(exameId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from('analises_curadas')
    .select('*')
    .eq('exame_id', exameId)
    .single();

  if (error || !data) return null;
  return data;
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

  const parsed = ExameSchema.safeParse(data);
  if (!parsed.success) throw new Error("Erro validação pós-insert");

  return parsed.data;
}

// ==============================
// ANALISES
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

// ==============================
// 📊 DASHBOARD METRICS
// ==============================

export async function contarExames(): Promise<number> {
  const { count, error } = await supabase
    .from("exames")
    .select("*", { count: "exact", head: true });

  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function contarExamesMesAtual(): Promise<number> {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("exames")
    .select("*", { count: "exact", head: true })
    .gte("data_exame", inicioMes.toISOString());

  if (error) throw new Error(error.message);
  return count ?? 0;
}