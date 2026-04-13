import type { ExameRow } from "../services/db";

export function gerarComparativoAutomatico(exames: ExameRow[]) 
{
  if (!exames || exames.length < 2) {
    return {
      melhoraram: [],
      pioraram: [],
      novos_problemas: [],
      normalizados: [],
    };
  }

  const anterior = exames[exames.length - 2];
  const atual = exames[exames.length - 1];

  const antes =
    (anterior.analise_ia as any)?.pontos_criticos ??
    anterior.pontos_criticos ??
    [];

  const depois =
    (atual.analise_ia as any)?.pontos_criticos ??
    atual.pontos_criticos ??
    [];

  const melhoraram = antes.filter((p: string) => !depois.includes(p));
  const novos = depois.filter((p: string) => !antes.includes(p));

  return {
    melhoraram: melhoraram.map((p: string) => ({
      sistema: "Geral",
      item: p,
      antes: "alto",
      depois: "normal",
      evolucao: "melhora",
    })),

    pioraram: novos.map((p: string) => ({
      sistema: "Geral",
      item: p,
      antes: "normal",
      depois: "alto",
      evolucao: "piora",
    })),

    novos_problemas: [],
    normalizados: [],
  };
}