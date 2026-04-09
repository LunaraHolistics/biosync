// frontend/src/types/plano_terapeutico.ts

export type PlanoTerapeuticoTipo = 
  | "semanal" 
  | "quinzenal" 
  | "mensal" 
  | "personalizado"; // ✅ Adicionado para compatibilidade com o backend

export type ItemPlanoTerapeutico = {
  nome: string;
  descricao: string;
  frequencia: string;
  justificativa: string;
};

export type PlanoTerapeutico = {
  tipo: PlanoTerapeuticoTipo;
  terapias: ItemPlanoTerapeutico[];
};