import { z } from "zod";

// 🔥 EXAME
export const ExameSchema = z.object({
  id: z.string(),
  nome_paciente: z.string(),
  data_exame: z.string(),

  resultado_json: z.record(z.any()).default({}),

  analise_ia: z.record(z.any()).optional(),

  protocolo: z.string().nullable().optional(),
  pontos_criticos: z.array(z.string()).optional(),

  created_at: z.string(),
  updated_at: z.string().optional(),

  status: z.string().optional(),
  indice_biosync: z.record(z.any()).optional(),

  total_pioraram: z.number().optional(),
  total_melhoraram: z.number().optional(),
});

// 🔥 TERAPIAS
export const TerapiaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  categoria: z.string().nullable().optional(),
  descricao: z.string().nullable().optional(),
  indicacoes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  setores_alvo: z.array(z.string()).optional(),
});

// 🔥 BASE ANALISE
export const BaseAnaliseSchema = z.object({
  item: z.string(),
  descricao_tecnica: z.string(),
  impacto: z.string().nullable().optional(),
  setores: z.array(z.string()).optional(),
});