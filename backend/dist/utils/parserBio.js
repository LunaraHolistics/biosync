"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBioressonancia = parseBioressonancia;
function parseBioressonancia(texto) {
    const linhas = texto
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    const resultados = [];
    let sistemaAtual = "Geral";
    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        if (linha.includes("Cartão do Relatório") ||
            linha.includes("Relatório de Análise")) {
            const prev = linhas[i - 1];
            if (prev && prev.length < 80) {
                sistemaAtual = prev.replace(/[()]/g, "").trim();
            }
            continue;
        }
        const combinado = [
            linha,
            linhas[i + 1] || "",
            linhas[i + 2] || "",
        ].join(" ");
        const match = combinado.match(/(.+?)\s+([0-9.]+)\s*-\s*([0-9.]+)\s+([0-9.]+)/);
        if (match) {
            const item = match[1].replace(/\s+/g, " ").trim();
            const min = parseFloat(match[2]);
            const max = parseFloat(match[3]);
            const valor = parseFloat(match[4]);
            if (!item ||
                Number.isNaN(valor) ||
                Number.isNaN(min) ||
                Number.isNaN(max)) {
                continue;
            }
            let status = "normal";
            if (valor < min)
                status = "baixo";
            else if (valor > max)
                status = "alto";
            resultados.push({
                sistema: sistemaAtual,
                item,
                valor,
                min,
                max,
                status,
            });
        }
    }
    return resultados;
}
//# sourceMappingURL=parserBio.js.map