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

type EvolucaoItem = {
  sistema: string;
  item: string;
  antes: "baixo" | "normal" | "alto" | null;
  depois: "baixo" | "normal" | "alto" | null;
  valor_antes?: number;
  valor_depois?: number;
  variacao?: number;
  evolucao: "melhora" | "piora" | "novo" | "normalizado";
};

type ComparacaoExames = {
  melhoraram: EvolucaoItem[];
  pioraram: EvolucaoItem[];
  novos_problemas: EvolucaoItem[];
  normalizados: EvolucaoItem[];
};

function criarChave(sistema: string, item: string): string {
  return `${sistema}::${item}`;
}

function calcularVariacao(
  atual: ItemProcessado,
  anterior: ItemProcessado,
): number {
  return Number((atual.valor - anterior.valor).toFixed(2));
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

    if (!itemAnterior) {
      novos_problemas.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes: null,
        depois: itemAtual.status,
        valor_depois: itemAtual.valor,
        evolucao: "novo",
      });
      continue;
    }

    const antes = itemAnterior.status;
    const depois = itemAtual.status;

    const variacao = calcularVariacao(itemAtual, itemAnterior);

    // 🔥 MELHORA
    if ((antes === "baixo" || antes === "alto") && depois === "normal") {
      melhoraram.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes,
        depois,
        valor_antes: itemAnterior.valor,
        valor_depois: itemAtual.valor,
        variacao,
        evolucao: "melhora",
      });
      continue;
    }

    // 🔥 PIORA
    if (antes === "normal" && (depois === "baixo" || depois === "alto")) {
      pioraram.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes,
        depois,
        valor_antes: itemAnterior.valor,
        valor_depois: itemAtual.valor,
        variacao,
        evolucao: "piora",
      });
      continue;
    }

    // 🔥 MELHORA PARCIAL (novo)
    if (
      antes === "alto" &&
      depois === "alto" &&
      itemAtual.valor < itemAnterior.valor
    ) {
      melhoraram.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes,
        depois,
        valor_antes: itemAnterior.valor,
        valor_depois: itemAtual.valor,
        variacao,
        evolucao: "melhora",
      });
      continue;
    }

    if (
      antes === "baixo" &&
      depois === "baixo" &&
      itemAtual.valor > itemAnterior.valor
    ) {
      melhoraram.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes,
        depois,
        valor_antes: itemAnterior.valor,
        valor_depois: itemAtual.valor,
        variacao,
        evolucao: "melhora",
      });
      continue;
    }
  }

  for (const [chave, itemAnterior] of anteriorPorChave.entries()) {
    if (!atualPorChave.has(chave)) {
      normalizados.push({
        sistema: itemAnterior.sistema,
        item: itemAnterior.item,
        antes: itemAnterior.status,
        depois: null,
        valor_antes: itemAnterior.valor,
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