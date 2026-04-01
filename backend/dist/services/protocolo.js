"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gerarProtocoloPorCategoria = gerarProtocoloPorCategoria;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});
async function gerarProtocoloPorCategoria(problemas) {
    if (!problemas.length) {
        return { manha: [], tarde: [], noite: [] };
    }
    // 🔥 Extrai categorias únicas
    const categorias = Array.from(new Set(problemas.map((p) => p.categoria)));
    // 🔥 Busca terapias no banco
    const { rows } = await pool.query(`
    SELECT nome, categoria, prioridade
    FROM terapias
    WHERE categoria = ANY($1)
      AND ativo = true
    ORDER BY prioridade ASC
    `, [categorias]);
    // 🔥 Distribuição simples inteligente
    const manha = [];
    const tarde = [];
    const noite = [];
    rows.forEach((terapia, index) => {
        const nome = terapia.nome;
        if (index % 3 === 0)
            manha.push(nome);
        else if (index % 3 === 1)
            tarde.push(nome);
        else
            noite.push(nome);
    });
    return { manha, tarde, noite };
}
//# sourceMappingURL=protocolo.js.map