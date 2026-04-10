import type {
  BaseAnaliseSaudeRow,
  TerapiaRow,
  ExameRow,
} from "../services/db";

type ResultadoAnalise = {
  interpretacao: string;
  pontos_detalhados: any[];
  terapias: TerapiaRow[];
  justificativa: string;
};

export function gerarAnaliseInteligente(
  exame: ExameRow,
  base: BaseAnaliseSaudeRow[],
  terapias: TerapiaRow[]
): ResultadoAnalise {
  const pontos =
    exame.pontos_criticos ?? [];

  if (!pontos.length) {
    return {
      interpretacao: "Nenhuma alteração relevante encontrada.",
      pontos_detalhados: [],
      terapias: [],
      justificativa: "",
    };
  }

  // 🔍 buscar detalhes técnicos
  const detalhes = base.filter((item) =>
    pontos.includes(item.item)
  );

  // 🧠 montar interpretação
  const interpretacao = detalhes
    .map((d) => d.impacto || d.descricao_tecnica)
    .join(" ");

  // 🎯 coletar setores
  const setores = new Set<string>();

  detalhes.forEach((d) => {
    d.setores?.forEach((s) => setores.add(s));
  });

  // 🔥 match de terapias
  const terapiasSelecionadas = terapias.filter((t) => {
    if (!t.ativo) return false;

    const tags = t.tags ?? [];
    const setoresAlvo = t.setores_alvo ?? [];

    return (
      tags.some((tag) => setores.has(tag)) ||
      setoresAlvo.some((s) => setores.has(s))
    );
  });

  // 📝 justificativa
  const justificativa = terapiasSelecionadas
    .map(
      (t) =>
        `${t.nome}: indicada para ${t.indicacoes}`
    )
    .join("\n");

  return {
    interpretacao:
      interpretacao ||
      "Alterações identificadas requerem atenção.",
    pontos_detalhados: detalhes,
    terapias: terapiasSelecionadas,
    justificativa,
  };
}