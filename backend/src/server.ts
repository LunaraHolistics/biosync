console.log("SERVER ATIVO");
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import express from "express";
import cors from "cors";
import { createHash } from "crypto";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";

// Importando os parsers e serviços
import { parseHtmReport } from "./utils/parserHtml"; 
import { parseBioressonancia } from "./utils/parserBio";
import { gerarDiagnostico } from "./services/diagnostico.service";
import { gerarProtocolo } from "./services/motorTerapias.service";
import { compararExames } from "./services/comparador.service";

// Importando as rotas externas se houver
import uploadRouter from "./routes/upload";
import analyzeRoute from "./routes/analyze";

// --- Tipagens ---
type AiStructuredData = {
  interpretacao: string;
  pontos_criticos: string[];
  protocolo: { manha: string[]; tarde: string[]; noite: string[] };
  frequencia_lunara: string;
  justificativa: string;
};

// --- Funções Auxiliares ---
function fallbackData(): AiStructuredData {
  return {
    interpretacao: "Não foi possível gerar análise completa.",
    pontos_criticos: [],
    protocolo: { manha: [], tarde: [], noite: [] },
    frequencia_lunara: "N/A",
    justificativa: "Erro na interpretação automática.",
  };
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x) => typeof x === "string");
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  return [];
}

function toStringValue(value: unknown, defaultValue = ""): string {
  return typeof value === "string" ? value : defaultValue;
}

function normalizeAiData(input: unknown): AiStructuredData {
  const base = fallbackData();
  if (!input || typeof input !== "object") return base;

  const obj = input as Record<string, unknown>;
  const protocoloRaw = obj.protocolo;
  const protocoloObj = protocoloRaw && typeof protocoloRaw === "object"
      ? (protocoloRaw as Record<string, unknown>)
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

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const match = trimmed.match(/\{[\s\S]*\}/);
  return match?.[0] ?? null;
}

function gerarHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// --- Configuração do App ---
const app = express();

app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições de origens variadas (importante para plugins de browser)
    if (!origin || origin === 'null') {
      return callback(null, true);
    }
    callback(null, true);
  }
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Configuração do Multer (Memória)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// --- Rotas ---

// Health check
app.get("/health", (_, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Rota de Upload Processado (Usada pelo Plugin)
app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const resultadosProcessados = [];

    for (const file of files) {
      // Usamos o parseHtmReport que corrigimos para lidar com o buffer e encoding correto
      const dadosExtraidos = parseHtmReport(file.buffer);
      resultadosProcessados.push(dadosExtraidos);
    }

    // Gera um hash único para este lote de arquivos (ajuda a evitar duplicatas)
    const hash = gerarHash(Buffer.concat(files.map((f) => f.buffer)));

    console.log(`Relatório processado: ${resultadosProcessados[0]?.nome || 'Desconhecido'}`);

    return res.json({ 
      success: true,
      dados: resultadosProcessados, 
      hash 
    });

  } catch (err: any) {
    console.error("Erro no processamento do upload:", err);
    return res.status(500).json({
      error: err?.message ?? "Erro interno ao processar arquivo",
    });
  }
});

// Rota de Inteligência Artificial (Gemini)
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

app.post("/api/ai", async (req, res) => {
  try {
    const { prompt, comparacao, anterior_dados_processados } = req.body as {
      prompt?: string;
      comparacao?: unknown;
      anterior_dados_processados?: unknown;
    };

    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt' in request body" });
    }

    const dadosProcessados = parseBioressonancia(prompt);
    const diagnostico = gerarDiagnostico(dadosProcessados);
    const protocoloGerado = gerarProtocolo(diagnostico);

    let comparacaoFinal: unknown = comparacao ?? null;

    if (Array.isArray(anterior_dados_processados)) {
      try {
        comparacaoFinal = compararExames(
          dadosProcessados as any,
          anterior_dados_processados as any,
        );
      } catch {
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
      "SAÍDA (JSON OBRIGATÓRIO):",
      "{",
      '  "interpretacao": string,',
      '  "pontos_criticos": string[],',
      '  "protocolo": { "manha": string[], "tarde": string[], "noite": string[] },',
      '  "frequencia_lunara": string,',
      '  "justificativa": string',
      "}",
    ].join("\n");

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: structuredPrompt,
    });

    const raw = response.text ?? "";
    const candidate = extractJsonCandidate(raw);
    let parsed = candidate ? JSON.parse(candidate) : null;

    const data = normalizeAiData(parsed);
    data.protocolo = protocoloGerado;

    res.json({
      data,
      dadosProcessados,
      diagnostico,
      protocolo: protocoloGerado,
      comparacao: comparacaoFinal,
    });
  } catch (err: any) {
    res.status(500).json({ data: fallbackData(), error: err.message });
  }
});

// Outras rotas importadas
app.use(uploadRouter);
app.use(analyzeRoute);

const PORT = process.env.PORT || 10000; // Render usa porta 10000 por padrão

app.listen(PORT, () => {
  console.log(`Backend BioSync rodando na porta ${PORT}`);
});