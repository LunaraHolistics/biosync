type Status = "baixo" | "normal" | "alto";

type Evolucao =
  | "melhora"
  | "piora"
  | "novo"
  | "normalizado";

type EvolucaoItem = {
  sistema: string;
  item: string;
  antes: Status | null;
  depois: Status | null;
  evolucao: Evolucao;
};

export function gerarComparativoAutomatico(
  exameAntigo: any,
  exameNovo: any
) {
  const antes: string[] =
    exameAntigo.pontos_criticos ?? [];

  const depois: string[] =
    exameNovo.pontos_criticos ?? [];

  const melhoraram: EvolucaoItem[] = [];
  const pioraram: EvolucaoItem[] = [];
  const novos_problemas: EvolucaoItem[] = [];
  const normalizados: EvolucaoItem[] = [];

  const setAntes = new Set(antes);
  const setDepois = new Set(depois);

  // 🔴 NOVOS PROBLEMAS
  depois.forEach((item) => {
    if (!setAntes.has(item)) {
      novos_problemas.push({
        sistema: "Sistema",
        item,
        antes: null,
        depois: "alto",
        evolucao: "novo",
      });
    }
  });

  // ⚪ NORMALIZADOS
  antes.forEach((item) => {
    if (!setDepois.has(item)) {
      normalizados.push({
        sistema: "Sistema",
        item,
        antes: "alto",
        depois: null,
        evolucao: "normalizado",
      });
    }
  });

  // 🟡 ITENS QUE PERMANECEM
  antes.forEach((item) => {
    if (setDepois.has(item)) {
      // por enquanto neutro → você pode evoluir depois com score
      melhoraram.push({
        sistema: "Sistema",
        item,
        antes: "alto",
        depois: "alto",
        evolucao: "melhora",
      });
    }
  });

  return {
    melhoraram,
    pioraram,
    novos_problemas,
    normalizados,
  };
}