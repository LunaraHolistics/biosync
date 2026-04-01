export type Status = "baixo" | "normal" | "alto";

export type ItemProcessado = {
  sistema: string;
  item: string;
  valor: number;
  min: number;
  max: number;
  status: Status;
};

export type Evolucao = "melhora" | "piora" | "novo" | "normalizado";

export type EvolucaoItem = {
  sistema: string;
  item: string;
  antes: Status | null;
  depois: Status | null;
  evolucao: Evolucao;
};

export type ComparacaoExames = {
  melhoraram: EvolucaoItem[];
  pioraram: EvolucaoItem[];
  novos_problemas: EvolucaoItem[];
  normalizados: EvolucaoItem[];
};

function criarChave(sistema: string, item: string): string {
  return `${sistema}::${item}`;
}

export function compararExames(
  atual: ItemProcessado[],
  anterior: ItemProcessado[],
): ComparacaoExames {
  const anteriorPorChave = new Map<string, ItemProcessado>();
  const atualPorChave = new Map<string, ItemProcessado>();

  for (const item of anterior) {
    anteriorPorChave.set(criarChave(item.sistema, item.item), item);
  }

  for (const item of atual) {
    atualPorChave.set(criarChave(item.sistema, item.item), item);
  }

  const melhoraram: EvolucaoItem[] = [];
  const pioraram: EvolucaoItem[] = [];
  const novos_problemas: EvolucaoItem[] = [];
  const normalizados: EvolucaoItem[] = [];

  for (const [chave, itemAtual] of atualPorChave.entries()) {
    const itemAnterior = anteriorPorChave.get(chave);

    // Não existia antes: novo problema.
    if (!itemAnterior) {
      novos_problemas.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes: null,
        depois: itemAtual.status,
        evolucao: "novo",
      });
      continue;
    }

    const antes = itemAnterior.status;
    const depois = itemAtual.status;

    if ((antes === "baixo" || antes === "alto") && depois === "normal") {
      melhoraram.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes,
        depois,
        evolucao: "melhora",
      });
      continue;
    }

    if (antes === "normal" && (depois === "baixo" || depois === "alto")) {
      pioraram.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes,
        depois,
        evolucao: "piora",
      });
    }
  }

  for (const [chave, itemAnterior] of anteriorPorChave.entries()) {
    if (!atualPorChave.has(chave)) {
      normalizados.push({
        sistema: itemAnterior.sistema,
        item: itemAnterior.item,
        antes: itemAnterior.status,
        depois: null,
        evolucao: "normalizado",
      });
    }
  }

  return {
    melhoraram,
    pioraram,
    novos_problemas,
    normalizados,
  };
}
