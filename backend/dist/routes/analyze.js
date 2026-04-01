"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const parserBio_1 = require("../utils/parserBio");
const client_1 = require("../db/client");
const diagnostico_service_1 = require("../services/diagnostico.service");
const router = (0, express_1.Router)();
/**
 * Junta múltiplos textos em um único dataset
 */
function parseMultiplos(textos) {
    const todos = [];
    for (const texto of textos) {
        if (!texto || typeof texto !== "string")
            continue;
        const resultado = (0, parserBio_1.parseBioressonancia)(texto);
        if (Array.isArray(resultado) && resultado.length > 0) {
            todos.push(...resultado);
        }
    }
    return todos;
}
/**
 * Comparação entre exames
 */
function compararExames(atual, anterior) {
    if (!anterior || !Array.isArray(anterior))
        return null;
    const mapaAnterior = new Map(anterior.map((a) => [`${a.sistema}-${a.item}`, a]));
    const comparacao = atual
        .map((item) => {
        const key = `${item.sistema}-${item.item}`;
        const prev = mapaAnterior.get(key);
        if (!prev)
            return null;
        let tendencia = "estavel";
        if (item.valor < prev.valor)
            tendencia = "melhora";
        if (item.valor > prev.valor)
            tendencia = "piora";
        return {
            sistema: item.sistema,
            item: item.item,
            atual: item.valor,
            anterior: prev.valor,
            tendencia,
        };
    })
        .filter((x) => x !== null);
    return comparacao;
}
/**
 * Banco → protocolo
 */
async function gerarProtocoloNoBanco(tags) {
    const client = await client_1.pool.connect();
    try {
        const res = await client.query(`SELECT * FROM gerar_protocolo($1)`, [tags]);
        if (!res.rows || res.rows.length === 0) {
            return {
                manha: [],
                tarde: [],
                noite: [],
            };
        }
        return res.rows[0];
    }
    finally {
        client.release();
    }
}
/**
 * Extrai tags
 */
function extrairTags(diagnostico) {
    const tags = new Set();
    for (const p of diagnostico.problemas) {
        const texto = `${p.sistema} ${p.item}`.toLowerCase();
        if (texto.includes("inflama"))
            tags.add("inflamacao");
        if (texto.includes("ansiedade"))
            tags.add("ansiedade");
        if (texto.includes("energia"))
            tags.add("energia");
        if (texto.includes("imun"))
            tags.add("imunidade");
        if (texto.includes("stress") || texto.includes("estresse"))
            tags.add("estresse");
    }
    return Array.from(tags);
}
router.post("/api/analyze", async (req, res) => {
    try {
        const { prompt, anterior_dados_processados } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: "Prompt vazio" });
        }
        /**
         * 🔥 DEBUG INTELIGENTE
         */
        console.log("Tipo do prompt:", typeof prompt);
        if (Array.isArray(prompt)) {
            console.log("Qtd arquivos recebidos:", prompt.length);
        }
        /**
         * 1. Parse
         */
        const dadosProcessados = Array.isArray(prompt)
            ? parseMultiplos(prompt)
            : (0, parserBio_1.parseBioressonancia)(prompt);
        console.log("Itens processados:", dadosProcessados.length);
        if (!Array.isArray(dadosProcessados) || dadosProcessados.length === 0) {
            return res.status(400).json({
                error: "Falha ao processar dados de bioressonância",
            });
        }
        /**
         * 2. Diagnóstico
         */
        const diagnostico = (0, diagnostico_service_1.gerarDiagnostico)(dadosProcessados);
        /**
         * 3. Comparação
         */
        const comparacao = compararExames(dadosProcessados, anterior_dados_processados || null);
        /**
         * 4. Tags
         */
        const tags = extrairTags(diagnostico);
        /**
         * 5. Protocolo
         */
        const protocolo = await gerarProtocoloNoBanco(tags);
        /**
         * 6. Resposta
         */
        const resposta = {
            interpretacao: "Análise baseada em bioressonância com identificação de desequilíbrios energéticos e físicos.",
            pontos_criticos: diagnostico.problemas
                .filter((p) => p.prioridade === "alta")
                .map((p) => `${p.sistema} - ${p.item}`),
            protocolo: {
                manha: protocolo.manha || [],
                tarde: protocolo.tarde || [],
                noite: protocolo.noite || [],
            },
            frequencia_lunara: "Conforme protocolo terapêutico individual",
            justificativa: "Protocolo gerado automaticamente com base nos desequilíbrios detectados.",
        };
        return res.json({
            data: resposta,
            raw: JSON.stringify(resposta),
            dadosProcessados,
            diagnostico,
            comparacao,
            protocolo,
            reused: false,
        });
    }
    catch (error) {
        console.error("Erro /api/analyze:", error);
        return res.status(500).json({
            error: "Erro ao processar análise",
            details: error?.message,
        });
    }
});
exports.default = router;
//# sourceMappingURL=analyze.js.map