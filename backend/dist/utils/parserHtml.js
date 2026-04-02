"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseHtmlBioressonancia = parseHtmlBioressonancia;
const cheerio = __importStar(require("cheerio"));
function parseHtmlBioressonancia(html) {
    const $ = cheerio.load(html);
    let resultados = [];
    // 1️⃣ EXTRAÇÃO DE TABELAS
    $("table").each((_, table) => {
        $(table)
            .find("tr")
            .each((_, row) => {
            const cells = $(row).find("td");
            if (cells.length >= 2) {
                const nome = normalizeText($(cells[0]).text());
                const valor = extractNumber($(cells[1]).text());
                if (isValid(nome, valor)) {
                    resultados.push({ nome, valor });
                }
            }
        });
    });
    // 2️⃣ FALLBACK: DIVS / LINHAS SOLTAS
    if (resultados.length === 0) {
        $("body *").each((_, el) => {
            const text = normalizeText($(el).text());
            const match = tryParseLine(text);
            if (match)
                resultados.push(match);
        });
    }
    // 3️⃣ FALLBACK FINAL: TEXTO BRUTO
    if (resultados.length === 0) {
        const text = normalizeText($.text());
        text.split("\n").forEach((line) => {
            const match = tryParseLine(line);
            if (match)
                resultados.push(match);
        });
    }
    // 4️⃣ Remover duplicados
    const unique = deduplicate(resultados);
    return unique;
}
//
// 🧩 HELPERS
//
function normalizeText(text) {
    return text
        .replace(/\s+/g, " ")
        .replace(/\u00A0/g, " ")
        .trim();
}
function extractNumber(text) {
    if (!text)
        return null;
    // pega número com vírgula ou ponto
    const match = text.match(/-?\d+[.,]?\d*/);
    if (!match)
        return null;
    const num = match[0].replace(",", ".");
    return parseFloat(num);
}
function isValid(nome, valor) {
    if (!nome || valor === null)
        return false;
    const invalidLabels = [
        "item",
        "resultado",
        "valor",
        "score",
        "análise",
    ];
    if (invalidLabels.some((label) => nome.toLowerCase().includes(label))) {
        return false;
    }
    return true;
}
function tryParseLine(text) {
    if (!text)
        return null;
    // tenta separar texto + número
    const match = text.match(/^(.+?)\s*(-?\d+[.,]?\d*)$/);
    if (!match)
        return null;
    const nome = normalizeText(match[1]);
    const valor = extractNumber(match[2]);
    if (!isValid(nome, valor))
        return null;
    return { nome, valor };
}
function deduplicate(items) {
    const map = new Map();
    for (const item of items) {
        const key = item.nome.toLowerCase();
        if (!map.has(key)) {
            map.set(key, item);
        }
    }
    return Array.from(map.values());
}
//# sourceMappingURL=parserHtml.js.map