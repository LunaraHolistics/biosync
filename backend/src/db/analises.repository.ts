import { pool } from "./client";

export async function salvarNovaAnalise(data: {
  client_id: string;
  raw_text: string;
  result_text: string;
  dados_processados?: unknown;
  diagnostico?: unknown;
  comparacao?: unknown;
  protocolo?: unknown;
  pdf_hash: string;
}) {
  const res = await pool.query(
    `
    INSERT INTO analises (
      client_id,
      raw_text,
      result_text,
      dados_processados,
      diagnostico,
      comparacao,
      protocolo,
      pdf_hash
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *
    `,
    [
      data.client_id,
      data.raw_text,
      data.result_text,
      data.dados_processados ?? null,
      data.diagnostico ?? null,
      data.comparacao ?? null,
      data.protocolo ?? null,
      data.pdf_hash,
    ]
  );

  return res.rows[0];
}

export async function buscarAnalisePorHashECliente(
  clientId: string,
  hash: string
) {
  const res = await pool.query(
    `SELECT * FROM analises WHERE client_id = $1 AND pdf_hash = $2 LIMIT 1`,
    [clientId, hash]
  );

  return res.rows[0] ?? null;
}

export async function buscarUltimaAnalisePorCliente(clientId: string) {
  const res = await pool.query(
    `SELECT * FROM analises WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [clientId]
  );

  return res.rows[0] ?? null;
}