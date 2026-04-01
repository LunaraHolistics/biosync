"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gerarDiagnostico = gerarDiagnostico;
function normalize(input) {
    return input
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}
function analisarItem(item) {
    const texto = normalize(`${item.sistema} ${item.item}`);
    // 🔥 HORMONAL
    if (texto.includes("testosterona")) {
        return {
            impacto: "queda de energia, libido e vitalidade geral",
            prioridade: "alta",
            categoria: "hormonal",
        };
    }
    if (texto.includes("tireoide") || texto.includes("paratireoide")) {
        return {
            impacto: "desregulação metabólica e energética",
            prioridade: "alta",
            categoria: "hormonal",
        };
    }
    // 🔥 DIGESTIVO
    if (texto.includes("intestino") || texto.includes("digest")) {
        return {
            impacto: "baixa absorção de nutrientes e impacto na imunidade",
            prioridade: "alta",
            categoria: "digestivo",
        };
    }
    // 🔥 CIRCULATÓRIO
    if (texto.includes("circulacao") || texto.includes("vascular")) {
        return {
            impacto: "fadiga, baixa oxigenação e circulação deficiente",
            prioridade: "media",
            categoria: "circulatorio",
        };
    }
    // 🔥 IMUNOLÓGICO
    if (texto.includes("imun") || texto.includes("linfa")) {
        return {
            impacto: "queda da resposta imunológica",
            prioridade: "media",
            categoria: "imunologico",
        };
    }
    // 🔥 EMOCIONAL / NEUROLÓGICO
    if (texto.includes("cerebral") ||
        texto.includes("emocional") ||
        texto.includes("neuro")) {
        return {
            impacto: "sobrecarga mental, estresse e desequilíbrio emocional",
            prioridade: "media",
            categoria: "emocional",
        };
    }
    // 🔥 METAIS / TOXINAS
    if (texto.includes("metal") ||
        texto.includes("toxic") ||
        texto.includes("radiacao")) {
        return {
            impacto: "sobrecarga tóxica e interferência energética",
            prioridade: "alta",
            categoria: "toxico",
        };
    }
    // 🔥 GENÉRICO
    return {
        impacto: "desequilíbrio funcional leve",
        prioridade: "baixa",
        categoria: "geral",
    };
}
function calcularScore(item) {
    const range = item.max - item.min;
    if (range <= 0)
        return 0;
    const media = (item.min + item.max) / 2;
    const scoreBruto = (Math.abs(item.valor - media) / range) * 100;
    return Math.max(0, Math.min(100, Number(scoreBruto.toFixed(2))));
}
function classificarScore(score) {
    if (score <= 20)
        return "leve";
    if (score <= 50)
        return "moderado";
    return "severo";
}
function prioridadePorScore(score) {
    const classificacao = classificarScore(score);
    if (classificacao === "leve")
        return "baixa";
    if (classificacao === "moderado")
        return "media";
    return "alta";
}
function gerarDiagnostico(dados) {
    const problemas = dados
        .filter((item) => item.status === "baixo" || item.status === "alto")
        .map((item) => {
        const analise = analisarItem(item);
        const score = calcularScore(item);
        return {
            sistema: item.sistema,
            item: item.item,
            status: item.status,
            impacto: analise.impacto,
            categoria: analise.categoria,
            score,
            prioridade: prioridadePorScore(score),
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
//# sourceMappingURL=diagnostico.service.js.map