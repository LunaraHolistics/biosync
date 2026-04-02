"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const parserHtml_1 = require("../utils/parserHtml");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)();
/**
 * Remove tags HTML e limpa texto
 */
function limparHtml(html) {
    return html
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
router.post("/api/upload", upload.array("files"), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: "Nenhum arquivo enviado" });
        }
        const textos = [];
        const dadosEstruturados = [];
        for (const file of files) {
            try {
                const mimetype = file.mimetype;
                let texto = "";
                // 🔥 HTML
                if (mimetype.includes("html")) {
                    const raw = file.buffer.toString("utf-8");
                    // ✅ NOVO: parser estruturado
                    const dados = (0, parserHtml_1.parseHtmlBioressonancia)(raw);
                    if (dados.length > 0) {
                        dadosEstruturados.push(...dados);
                        console.log("✅ Dados estruturados extraídos:", dados.length);
                    }
                    else {
                        console.log("⚠️ Nenhum dado estruturado encontrado");
                    }
                    // mantém compatibilidade com fluxo antigo
                    texto = limparHtml(raw);
                    console.log("HTML processado");
                }
                // 🔥 TXT
                else if (mimetype.includes("text")) {
                    texto = file.buffer.toString("utf-8");
                    console.log("TXT processado");
                }
                // ⚠️ PDF (fallback simples)
                else if (mimetype.includes("pdf")) {
                    const raw = file.buffer.toString("utf-8");
                    console.log("PDF detectado (provavelmente imagem)");
                    texto = raw;
                }
                else {
                    console.log("Tipo não suportado:", mimetype);
                    continue;
                }
                // 🔍 DEBUG
                console.log("PREVIEW:");
                console.log(texto.slice(0, 300));
                if (texto && texto.length > 50) {
                    textos.push(texto);
                }
                else {
                    console.log("Arquivo ignorado (sem conteúdo útil)");
                }
            }
            catch (err) {
                console.error("Erro ao processar arquivo:", err);
            }
        }
        if (textos.length === 0 && dadosEstruturados.length === 0) {
            return res.status(400).json({
                error: "Nenhum conteúdo útil encontrado nos arquivos",
            });
        }
        return res.json({
            sucesso: true,
            textos,
            dadosEstruturados, // 🚀 NOVO
        });
    }
    catch (error) {
        console.error("Erro upload:", error);
        return res.status(500).json({
            error: "Erro ao processar upload",
            details: error?.message,
        });
    }
});
exports.default = router;
//# sourceMappingURL=upload.js.map