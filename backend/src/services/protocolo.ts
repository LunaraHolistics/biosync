import { Pool } from "pg";
import type { Problema } from "./diagnostico.service";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

type TerapiaDB = {
  nome: string;
  descricao: string;
  categoria: string;
  prioridade: number;
};

export type ItemPlanoTerapeutico = {
  nome: string;
  descricao: string;
  frequencia: string;
  justificativa: string;
};

export type PlanoTerapeutico = {
  tipo: "semanal" | "quinzenal" | "mensal";
  terapias: ItemPlanoTerapeutico[];
};

function gerarFrequencia(prioridade: string): string {
  if (prioridade === "alta") return "2 a 3x por semana";
  if (prioridade === "media") return "1 a 2x por semana";
  return "1x por semana";
}

function gerarJustificativa(problema: Problema): string {
  return `Indicada para auxiliar no equilíbrio de ${problema.sistema.toLowerCase()}, atuando diretamente sobre ${problema.item.toLowerCase()}.`;
}

export async function gerarPlanoTerapeutico(
  problemas: Problema[],
): Promise<PlanoTerapeutico> {
  if (!problemas.length) {
    return {
      tipo: "semanal",
      terapias: [],
    };
  }

  // 🔥 Categorias únicas
  const categorias = Array.from(
    new Set(problemas.map((p) => p.categoria)),
  );

  // 🔥 Busca terapias do banco
  const { rows } = await pool.query<TerapiaDB>(
    `
    SELECT nome, descricao, categoria, prioridade
    FROM terapias
    WHERE categoria = ANY($1)
      AND ativo = true
    ORDER BY prioridade ASC
    `,
    [categorias],
  );

  // 🔥 Monta lista estruturada
  const terapias: ItemPlanoTerapeutico[] = [];

  for (const terapia of rows) {
    const problemaRelacionado = problemas.find(
      (p) => p.categoria === terapia.categoria,
    );

    terapias.push({
      nome: terapia.nome,
      descricao: terapia.descricao,
      frequencia: gerarFrequencia(problemaRelacionado?.prioridade || "baixa"),
      justificativa: problemaRelacionado
        ? gerarJustificativa(problemaRelacionado)
        : "Indicada para equilíbrio geral",
    });
  }

  return {
    tipo: "semanal",
    terapias,
  };
}