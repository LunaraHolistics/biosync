import { z } from "zod";

// 🔥 EXAME
export const ExameSchema = z.object({
  id: z.string(),
  nome_paciente: z.string(),
  data_exame: z.string(),

  // Campos JSON flexíveis (aceitam objeto, array ou null)
  resultado_json: z.union([z.record(z.unknown()), z.array(z.unknown()), z.null()]).optional(),
  indice_biosync: z.union([z.record(z.unknown()), z.null()]).optional(),

  // Analise IA - objeto genérico opcional
  analise_ia: z.record(z.unknown()).optional(),

  protocolo: z.string().nullable().optional(),
  pontos_criticos: z.array(z.string()).optional(),

  created_at: z.string(),
  updated_at: z.string().optional(),

  status: z.string().optional(),

  // Métricas de comparativo
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