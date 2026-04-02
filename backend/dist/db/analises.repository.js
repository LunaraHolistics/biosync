"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.salvarNovaAnalise = salvarNovaAnalise;
exports.buscarAnalisePorHashECliente = buscarAnalisePorHashECliente;
exports.buscarUltimaAnalisePorCliente = buscarUltimaAnalisePorCliente;
const client_1 = require("./client");
async function salvarNovaAnalise(data) {
    const res = await client_1.pool.query(`
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
    `, [
        data.client_id,
        data.raw_text,
        data.result_text,
        data.dados_processados ?? null,
        data.diagnostico ?? null,
        data.comparacao ?? null,
        data.protocolo ?? null,
        data.pdf_hash,
    ]);
    return res.rows[0];
}
async function buscarAnalisePorHashECliente(clientId, hash) {
    const res = await client_1.pool.query(`SELECT * FROM analises WHERE client_id = $1 AND pdf_hash = $2 LIMIT 1`, [clientId, hash]);
    return res.rows[0] ?? null;
}
async function buscarUltimaAnalisePorCliente(clientId) {
    const res = await client_1.pool.query(`SELECT * FROM analises WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1`, [clientId]);
    return res.rows[0] ?? null;
}
//# sourceMappingURL=analises.repository.js.map