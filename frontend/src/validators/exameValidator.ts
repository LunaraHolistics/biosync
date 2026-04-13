import { z } from "zod";

// 🔥 EXAME
export const ExameSchema = z.object({
  id: z.string(),
  nome_paciente: z.string(),
  data_exame: z.string(),

  resultado_json: z.union([z.record(z.unknown()), z.array(z.unknown()), z.null()]).optional(),
  indice_biosync: z.union([z.record(z.unknown()), z.null()]).optional(),

  analise_ia: z.record(z.unknown()).optional(),

  protocolo: z.string().nullable().optional(),
  pontos_criticos: z.array(z.string()).optional(),

  created_at: z.string(),
  updated_at: z.string().optional(),

  status: z.string().optional(),

  total_pioraram: z.number().optional(),
  total_melhoraram: z.number().optional(),
});

// 🔥 TERAPIAS (campos reais do banco)
export const TerapiaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  categoria: z.string().nullable().optional(),
  descricao: z.string().nullable().optional(),
  indicacoes: z.string().nullable().optional(),
  contraindicacoes: z.string().nullable().optional(),
  frequencia_recomendada: z.string().nullable().optional(),
  prioridade: z.number().optional(),
  ativo: z.boolean().optional(),
  created_at: z.string().optional(),
  tags: z.array(z.string()).optional(),
  setores_alvo: z.array(z.string()).optional(),
});

// 🔥 BASE ANALISE (campos reais do banco)
export const BaseAnaliseSchema = z.object({
  id: z.number().optional(),
  categoria: z.string().nullable().optional(),
  item: z.string(),
  descricao_tecnica: z.string().nullable().optional(),
  descricao_paciente: z.string().nullable().optional(),
  impacto: z.string().nullable().optional(),
  setores: z.array(z.string()).nullable().optional(),
  palavras_chave: z.array(z.string()).nullable().optional(),
  sistemas_relacionados: z.array(z.string()).nullable().optional(),
});