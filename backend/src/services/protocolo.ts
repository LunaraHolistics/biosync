import { Pool } from "pg";
import type { Problema } from "./diagnostico.service";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

type Terapia = {
  nome: string;
  categoria: string;
  prioridade: number;
};

type Protocolo = {
  manha: string[];
  tarde: string[];
  noite: string[];
};

export async function gerarProtocoloPorCategoria(
  problemas: Problema[],
): Promise<Protocolo> {
  if (!problemas.length) {
    return { manha: [], tarde: [], noite: [] };
  }

  // 🔥 Extrai categorias únicas
  const categorias = Array.from(
    new Set(problemas.map((p) => p.categoria)),
  );

  // 🔥 Busca terapias no banco
  const { rows } = await pool.query<Terapia>(
    `
    SELECT nome, categoria, prioridade
    FROM terapias
    WHERE categoria = ANY($1)
      AND ativo = true
    ORDER BY prioridade ASC
    `,
    [categorias],
  );

  // 🔥 Distribuição simples inteligente
  const manha: string[] = [];
  const tarde: string[] = [];
  const noite: string[] = [];

  rows.forEach((terapia, index) => {
    const nome = terapia.nome;

    if (index % 3 === 0) manha.push(nome);
    else if (index % 3 === 1) tarde.push(nome);
    else noite.push(nome);
  });

  return { manha, tarde, noite };
}