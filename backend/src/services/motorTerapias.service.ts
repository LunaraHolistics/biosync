import type { Diagnostico, Problema } from "./diagnostico.service";
import type { PlanoTerapeutico, ItemPlanoTerapeutico } from "../types/planoTerapeutico";

function adicionarUnico(lista: ItemPlanoTerapeutico[], item: ItemPlanoTerapeutico) {
  if (!lista.some((t) => t.nome === item.nome)) {
    lista.push(item);
  }
}

function criarTerapiaBase(problema: Problema): ItemPlanoTerapeutico[] {
  const { categoria, prioridade, item } = problema;

  const terapias: ItemPlanoTerapeutico[] = [];

  // 🔥 HORMONAL
  if (categoria === "hormonal") {
    terapias.push({
      nome: "Regulação Hormonal Energética",
      descricao: "Técnicas para equilibrar eixo hormonal e vitalidade geral",
      frequencia: "3x por semana",
      justificativa: `Desequilíbrio identificado em ${item}`,
    });
  }

  // 🔥 DIGESTIVO
  if (categoria === "digestivo") {
    terapias.push({
      nome: "Reequilíbrio Digestivo",
      descricao: "Suporte para absorção de nutrientes e função intestinal",
      frequencia: "Diário",
      justificativa: `Impacto digestivo detectado em ${item}`,
    });
  }

  // 🔥 CIRCULATÓRIO
  if (categoria === "circulatorio") {
    terapias.push({
      nome: "Ativação Circulatória",
      descricao: "Estímulo energético e físico da circulação",
      frequencia: "3x por semana",
      justificativa: `Comprometimento circulatório em ${item}`,
    });
  }

  // 🔥 IMUNOLÓGICO
  if (categoria === "imunologico") {
    terapias.push({
      nome: "Fortalecimento Imunológico",
      descricao: "Técnicas para aumentar resistência do organismo",
      frequencia: "Contínuo",
      justificativa: `Sistema imune impactado em ${item}`,
    });
  }

  // 🔥 EMOCIONAL
  if (categoria === "emocional") {
    terapias.push({
      nome: "Regulação Emocional",
      descricao: "Equilíbrio mental e emocional",
      frequencia: "Diário",
      justificativa: `Sobrecarga emocional detectada em ${item}`,
    });
  }

  // 🔥 TÓXICO
  if (categoria === "toxico") {
    terapias.push({
      nome: "Desintoxicação Energética",
      descricao: "Limpeza de cargas tóxicas e interferências",
      frequencia: "Semanal",
      justificativa: `Presença de toxinas associada a ${item}`,
    });
  }

  // 🔥 PRIORIDADE ALTA → terapia intensiva
  if (prioridade === "alta") {
    terapias.push({
      nome: "Intervenção Terapêutica Intensiva",
      descricao: "Ação focada no principal desequilíbrio identificado",
      frequencia: "2 a 3x por semana",
      justificativa: `Alta prioridade no item ${item}`,
    });
  }

  return terapias;
}

export function gerarPlanoTerapeutico(diagnostico: Diagnostico): PlanoTerapeutico {
  const terapias: ItemPlanoTerapeutico[] = [];

  diagnostico.problemas.forEach((problema) => {
    const novas = criarTerapiaBase(problema);

    novas.forEach((t) => adicionarUnico(terapias, t));
  });

  return {
    tipo: "personalizado",
    terapias,
  };
}