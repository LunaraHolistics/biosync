export type PlanoTerapeuticoTipo =
  | "semanal"
  | "quinzenal"
  | "mensal"
  | "personalizado";

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