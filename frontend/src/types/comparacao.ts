export type ItemComparacao = {
  sistema: string;
  item: string;
  antes: "baixo" | "normal" | "alto" | null;
  depois: "baixo" | "normal" | "alto" | null;
  evolucao: string;
};

export type ComparacaoExames = {
  melhoraram: ItemComparacao[];
  pioraram: ItemComparacao[];
  novos_problemas: ItemComparacao[];
  normalizados: ItemComparacao[];
};