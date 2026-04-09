export type ItemProcessado = {
  sistema: string;
  item: string;
  valor: number;
  min: number;
  max: number;
  status: "baixo" | "normal" | "alto";
};

export type ImpactoFitness = {
  performance?: string;
  hipertrofia?: string;
  emagrecimento?: string;
  recuperacao?: string;
  humor?: string;
};

export type Problema = {
  sistema: string;
  item: string;
  status: "baixo" | "alto";
  impacto: string;
  categoria: string;
  score: number;
  prioridade: "baixa" | "media" | "alta";
  impacto_fitness?: ImpactoFitness;
};

export type Diagnostico = {
  problemas: Problema[];
  resumo: {
    total: number;
    alta: number;
    media: number;
    baixa: number;
  };
};

// 🔥 tipo interno correto
type AnaliseItem = {
  impacto: string;
  prioridadeBase: "baixa" | "media" | "alta";
  categoria: string;
  impacto_fitness?: ImpactoFitness;
};

function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function analisarItem(item: ItemProcessado): AnaliseItem {
  const texto = normalize(`${item.sistema} ${item.item}`);

  // 🔥 HORMONAL
  if (texto.includes("testosterona")) {
    return {
      impacto: "queda de energia, libido e vitalidade geral",
      prioridadeBase: "alta",
      categoria: "hormonal",
      impacto_fitness: {
        performance: "redução de força e disposição",
        hipertrofia: "dificuldade de ganho muscular",
        humor: "queda de motivação",
      },
    };
  }

  if (texto.includes("tireoide") || texto.includes("paratireoide")) {
    return {
      impacto: "desregulação metabólica e energética",
      prioridadeBase: "alta",
      categoria: "hormonal",
      impacto_fitness: {
        emagrecimento: "dificuldade ou aceleração desregulada",
        performance: "baixa energia",
      },
    };
  }

  // 🔥 DIGESTIVO
  if (texto.includes("intestino") || texto.includes("digest")) {
    return {
      impacto: "baixa absorção de nutrientes e impacto na imunidade",
      prioridadeBase: "alta",
      categoria: "digestivo",
      impacto_fitness: {
        hipertrofia: "baixa absorção proteica",
        recuperacao: "recuperação prejudicada",
      },
    };
  }

  // 🔥 CIRCULATÓRIO
  if (texto.includes("circulacao") || texto.includes("vascular")) {
    return {
      impacto: "fadiga, baixa oxigenação e circulação deficiente",
      prioridadeBase: "media",
      categoria: "circulatorio",
      impacto_fitness: {
        performance: "queda de resistência",
        recuperacao: "lentidão na recuperação",
      },
    };
  }

  // 🔥 IMUNOLÓGICO
  if (texto.includes("imun") || texto.includes("linfa")) {
    return {
      impacto: "queda da resposta imunológica",
      prioridadeBase: "media",
      categoria: "imunologico",
      impacto_fitness: {
        recuperacao: "maior tempo de recuperação",
      },
    };
  }

  // 🔥 EMOCIONAL
  if (
    texto.includes("cerebral") ||
    texto.includes("emocional") ||
    texto.includes("neuro")
  ) {
    return {
      impacto: "sobrecarga mental e desequilíbrio emocional",
      prioridadeBase: "media",
      categoria: "emocional",
      impacto_fitness: {
        performance: "queda de foco",
        humor: "instabilidade emocional",
      },
    };
  }

  // 🔥 TÓXICO
  if (
    texto.includes("metal") ||
    texto.includes("toxic") ||
    texto.includes("radiacao")
  ) {
    return {
      impacto: "sobrecarga tóxica e interferência energética",
      prioridadeBase: "alta",
      categoria: "toxico",
      impacto_fitness: {
        performance: "fadiga constante",
        recuperacao: "baixa regeneração",
      },
    };
  }

  return {
    impacto: "desequilíbrio funcional leve",
    prioridadeBase: "baixa",
    categoria: "geral",
    impacto_fitness: {},
  };
}

function calcularScore(item: ItemProcessado): number {
  const range = item.max - item.min;
  if (range <= 0) return 0;

  const media = (item.min + item.max) / 2;
  const scoreBruto = (Math.abs(item.valor - media) / range) * 100;

  return Math.max(0, Math.min(100, Number(scoreBruto.toFixed(2))));
}

function prioridadeFinal(
  score: number,
  prioridadeBase: "baixa" | "media" | "alta"
): "baixa" | "media" | "alta" {
  if (score > 60) return "alta";
  if (score > 30) return "media";
  return prioridadeBase;
}

export function gerarDiagnostico(dados: ItemProcessado[]): Diagnostico {
  const problemas: Problema[] = dados
    .filter((item) => item.status === "baixo" || item.status === "alto")
    .map((item) => {
      const analise = analisarItem(item);
      const score = calcularScore(item);

      return {
        sistema: item.sistema,
        item: item.item,
        status: item.status as "baixo" | "alto",
        impacto: analise.impacto,
        categoria: analise.categoria,
        score,
        prioridade: prioridadeFinal(score, analise.prioridadeBase),
        impacto_fitness: analise.impacto_fitness,
      };
    });

  const resumo = {
    total: problemas.length,
    alta: problemas.filter((p) => p.prioridade === "alta").length,
    media: problemas.filter((p) => p.prioridade === "media").length,
    baixa: problemas.filter((p) => p.prioridade === "baixa").length,
  };

  return { problemas, resumo };
}