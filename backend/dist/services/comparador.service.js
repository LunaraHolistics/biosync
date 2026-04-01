"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compararExames = compararExames;
function criarChave(sistema, item) {
    return `${sistema}::${item}`;
}
function compararExames(atual, anterior) {
    const anteriorPorChave = new Map();
    const atualPorChave = new Map();
    for (const item of anterior) {
        anteriorPorChave.set(criarChave(item.sistema, item.item), item);
    }
    for (const item of atual) {
        atualPorChave.set(criarChave(item.sistema, item.item), item);
    }
    const melhoraram = [];
    const pioraram = [];
    const novos_problemas = [];
    const normalizados = [];
    for (const [chave, itemAtual] of atualPorChave.entries()) {
        const itemAnterior = anteriorPorChave.get(chave);
        // Não existia antes: novo problema.
        if (!itemAnterior) {
            novos_problemas.push({
                sistema: itemAtual.sistema,
                item: itemAtual.item,
                antes: null,
                depois: itemAtual.status,
                evolucao: "novo",
            });
            continue;
        }
        const antes = itemAnterior.status;
        const depois = itemAtual.status;
        if ((antes === "baixo" || antes === "alto") && depois === "normal") {
            melhoraram.push({
                sistema: itemAtual.sistema,
                item: itemAtual.item,
                antes,
                depois,
                evolucao: "melhora",
            });
            continue;
        }
        if (antes === "normal" && (depois === "baixo" || depois === "alto")) {
            pioraram.push({
                sistema: itemAtual.sistema,
                item: itemAtual.item,
                antes,
                depois,
                evolucao: "piora",
            });
        }
    }
    for (const [chave, itemAnterior] of anteriorPorChave.entries()) {
        if (!atualPorChave.has(chave)) {
            normalizados.push({
                sistema: itemAnterior.sistema,
                item: itemAnterior.item,
                antes: itemAnterior.status,
                depois: null,
                evolucao: "normalizado",
            });
        }
    }
    return {
        melhoraram,
        pioraram,
        novos_problemas,
        normalizados,
    };
}
//# sourceMappingURL=comparador.service.js.map