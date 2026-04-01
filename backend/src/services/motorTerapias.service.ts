import type { Diagnostico, Problema } from "./diagnostico.service";

export type Protocolo = {
  manha: string[];
  tarde: string[];
  noite: string[];
};

function adicionarUnico(lista: string[], item: string) {
  if (!lista.includes(item)) lista.push(item);
}

function aplicarRegra(problema: Problema, protocolo: Protocolo) {
  const { categoria, prioridade } = problema;

  // 🔥 HORMONAL
  if (categoria === "hormonal") {
    adicionarUnico(protocolo.manha, "Exposição ao sol 10–15 min");
    adicionarUnico(protocolo.manha, "Estímulo energético com respiração ativa");
    adicionarUnico(protocolo.tarde, "Ajuste alimentar focado em suporte hormonal");
    adicionarUnico(protocolo.noite, "Relaxamento profundo para equilíbrio endócrino");
  }

  // 🔥 DIGESTIVO
  if (categoria === "digestivo") {
    adicionarUnico(protocolo.manha, "Água morna com limão em jejum");
    adicionarUnico(protocolo.tarde, "Uso de probióticos naturais");
    adicionarUnico(protocolo.tarde, "Alimentação leve e de fácil digestão");
    adicionarUnico(protocolo.noite, "Evitar alimentos inflamatórios");
  }

  // 🔥 CIRCULATÓRIO
  if (categoria === "circulatorio") {
    adicionarUnico(protocolo.manha, "Ativação corporal leve (caminhada)");
    adicionarUnico(protocolo.tarde, "Hidratação reforçada");
    adicionarUnico(protocolo.noite, "Massagem ou estímulo circulatório");
  }

  // 🔥 IMUNOLÓGICO
  if (categoria === "imunologico") {
    adicionarUnico(protocolo.manha, "Suplementação natural de suporte imunológico");
    adicionarUnico(protocolo.tarde, "Contato com natureza / grounding");
    adicionarUnico(protocolo.noite, "Sono reparador (prioridade)");
  }

  // 🔥 EMOCIONAL
  if (categoria === "emocional") {
    adicionarUnico(protocolo.manha, "Respiração consciente 5 minutos");
    adicionarUnico(protocolo.tarde, "Pausas de regulação emocional");
    adicionarUnico(protocolo.noite, "Meditação ou relaxamento guiado");
  }

  // 🔥 TÓXICO
  if (categoria === "toxico") {
    adicionarUnico(protocolo.manha, "Hidratação intensa");
    adicionarUnico(protocolo.tarde, "Suporte hepático natural");
    adicionarUnico(protocolo.noite, "Evitar exposição a toxinas");
  }

  // 🔥 PRIORIDADE ALTA → reforço
  if (prioridade === "alta") {
    adicionarUnico(protocolo.manha, "Foco terapêutico principal do dia");
    adicionarUnico(protocolo.noite, "Técnica de integração energética profunda");
  }
}

export function gerarProtocolo(diagnostico: Diagnostico): Protocolo {
  const protocolo: Protocolo = {
    manha: [],
    tarde: [],
    noite: [],
  };

  diagnostico.problemas.forEach((p) => {
    aplicarRegra(p, protocolo);
  });

  return protocolo;
}