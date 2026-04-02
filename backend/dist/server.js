"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
console.log("SERVER ATIVO");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: "./.env" });
const upload_1 = __importDefault(require("./routes/upload"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const crypto_1 = require("crypto");
const genai_1 = require("@google/genai");
const multer_1 = __importDefault(require("multer"));
const parserBio_1 = require("./utils/parserBio");
const diagnostico_service_1 = require("./services/diagnostico.service");
const motorTerapias_service_1 = require("./services/motorTerapias.service");
const comparador_service_1 = require("./services/comparador.service");
const analyze_1 = __importDefault(require("./routes/analyze"));
function fallbackData() {
    return {
        interpretacao: "Não foi possível gerar análise completa.",
        pontos_criticos: [],
        protocolo: { manha: [], tarde: [], noite: [] },
        frequencia_lunara: "N/A",
        justificativa: "Erro na interpretação automática.",
    };
}
function toStringArray(value) {
    if (Array.isArray(value))
        return value.filter((x) => typeof x === "string");
    if (typeof value === "string")
        return value.trim() ? [value.trim()] : [];
    return [];
}
function toStringValue(value, defaultValue = "") {
    return typeof value === "string" ? value : defaultValue;
}
function normalizeAiData(input) {
    const base = fallbackData();
    if (!input || typeof input !== "object")
        return base;
    const obj = input;
    const protocoloRaw = obj.protocolo;
    const protocoloObj = protocoloRaw && typeof protocoloRaw === "object"
        ? protocoloRaw
        : {};
    return {
        interpretacao: toStringValue(obj.interpretacao, base.interpretacao),
        pontos_criticos: toStringArray(obj.pontos_criticos),
        protocolo: {
            manha: toStringArray(protocoloObj.manha),
            tarde: toStringArray(protocoloObj.tarde),
            noite: toStringArray(protocoloObj.noite),
        },
        frequencia_lunara: toStringValue(obj.frequencia_lunara, base.frequencia_lunara),
        justificativa: toStringValue(obj.justificativa, base.justificativa),
    };
}
function extractJsonCandidate(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return null;
    if (trimmed.startsWith("{") && trimmed.endsWith("}"))
        return trimmed;
    const match = trimmed.match(/\{[\s\S]*\}/);
    return match?.[0] ?? null;
}
function gerarHash(buffer) {
    return (0, crypto_1.createHash)("sha256").update(buffer).digest("hex");
}
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: [
        "http://localhost:5173",
        "https://biosync-nu.vercel.app"
    ],
    methods: ["GET", "POST"],
}));
app.use(express_1.default.json({ limit: "50mb" }));
app.use(express_1.default.urlencoded({ limit: "50mb", extended: true }));
app.use(upload_1.default);
// 🔥 Health check (produção)
app.get("/health", (_, res) => {
    res.json({ status: "ok" });
});
// 🔥 rota principal determinística (sem IA)
app.use(analyze_1.default);
const ai = new genai_1.GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || "",
});
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: {
        fileSize: 20 * 1024 * 1024,
    },
});
app.post("/api/ai", async (req, res) => {
    try {
        const { prompt, comparacao, anterior_dados_processados } = req.body;
        if (!prompt) {
            res.status(400).json({ error: "Missing 'prompt' in request body" });
            return;
        }
        const dadosProcessados = (0, parserBio_1.parseBioressonancia)(prompt);
        const diagnostico = (0, diagnostico_service_1.gerarDiagnostico)(dadosProcessados);
        const protocoloGerado = (0, motorTerapias_service_1.gerarProtocolo)(diagnostico);
        let comparacaoFinal = comparacao ?? null;
        if (Array.isArray(anterior_dados_processados)) {
            try {
                comparacaoFinal = (0, comparador_service_1.compararExames)(dadosProcessados, anterior_dados_processados);
            }
            catch {
                comparacaoFinal = comparacao ?? null;
            }
        }
        const structuredPrompt = [
            "Você é um terapeuta holístico especializado em terapias integrativas.",
            "",
            "TAREFA:",
            "- Interpretar os problemas identificados",
            "- Explicar os impactos no corpo e emocional",
            "- Justificar o protocolo terapêutico fornecido",
            "",
            "SE HOUVER DADOS DE COMPARAÇÃO ENTRE EXAMES:",
            "- explique a evolução do paciente",
            "- destaque melhorias e agravamentos",
            "- ajuste a justificativa com base nessa evolução",
            "",
            "IMPORTANTE:",
            "- O protocolo JÁ FOI DEFINIDO por um sistema especialista",
            "- NÃO altere o protocolo",
            "- NÃO invente dados fora da entrada",
            "",
            "ENTRADA:",
            JSON.stringify({
                problemas: diagnostico.problemas,
                protocolo: protocoloGerado,
                comparacao: comparacaoFinal,
            }, null, 2),
            "",
            "SAÍDA (JSON OBRIGATÓRIO):",
            "{",
            '  "interpretacao": string,',
            '  "pontos_criticos": string[],',
            '  "protocolo": {',
            '    "manha": string[],',
            '    "tarde": string[],',
            '    "noite": string[]',
            "  },",
            '  "frequencia_lunara": string,',
            '  "justificativa": string',
            "}",
            "",
            "REGRAS:",
            "- Use exatamente o protocolo fornecido",
            "- A interpretação deve ser clara, clínica e profissional",
            "- A justificativa deve conectar problemas, protocolo e (quando existir) evolução entre exames",
        ].join("\n");
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: structuredPrompt,
        });
        const raw = response.text ?? "";
        let parsed = null;
        const candidate = extractJsonCandidate(raw);
        if (candidate) {
            try {
                parsed = JSON.parse(candidate);
            }
            catch {
                parsed = null;
            }
        }
        const data = normalizeAiData(parsed);
        data.protocolo = protocoloGerado;
        res.json({
            data,
            raw,
            dadosProcessados,
            diagnostico,
            protocolo: protocoloGerado,
            comparacao: comparacaoFinal,
            reused: false,
        });
    }
    catch (err) {
        const raw = err?.message ? String(err.message) : "Unknown error";
        res.status(500).json({ data: fallbackData(), raw });
    }
});
app.post("/api/upload", upload.array("files"), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({
                error: "Nenhum arquivo enviado",
            });
        }
        const textos = [];
        for (const file of files) {
            const text = file.buffer.toString("utf-8");
            textos.push(text);
        }
        const hash = gerarHash(Buffer.concat(files.map((f) => f.buffer)));
        return res.json({ textos, hash });
    }
    catch (err) {
        return res.status(500).json({
            error: err?.message ?? "Erro upload",
        });
    }
});
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Backend rodando na porta ${PORT}`);
});
//# sourceMappingURL=server.js.map