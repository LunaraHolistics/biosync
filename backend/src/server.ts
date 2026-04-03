console.log("SERVER ATIVO");
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });
import uploadRouter from "./routes/upload";
import express from "express";
import cors from "cors";
import { createHash } from "crypto";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";

import { parseBioressonancia } from "./utils/parserBio";
import { gerarDiagnostico } from "./services/diagnostico.service";
import { gerarProtocolo } from "./services/motorTerapias.service";
import { compararExames } from "./services/comparador.service";
import analyzeRoute from "./routes/analyze";

type AiStructuredData = {
  interpretacao: string;
  pontos_criticos: string[];
  protocolo: { manha: string[]; tarde: string[]; noite: string[] };
  frequencia_lunara: string;
  justificativa: string;
};

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
  const protocoloObj =
    protocoloRaw && typeof protocoloRaw === "object"
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

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    // Permite requisições do Vercel, do Render e de arquivos locais (null)
    if (!origin || origin === 'null') {
      return callback(null, true);
    }
    callback(null, true);
  }
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(uploadRouter);

// 🔥 Health check (produção)
app.get("/health", (_, res) => {
  res.json({ status: "ok" });
});

// 🔥 rota principal determinística (sem IA)
app.use(analyzeRoute);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

app.post("/api/ai", async (req, res) => {
  try {
    const { prompt, comparacao, anterior_dados_processados } = req.body as {
      prompt?: string;
      comparacao?: unknown;
      anterior_dados_processados?: unknown;
    };

    if (!prompt) {
      res.status(400).json({ error: "Missing 'prompt' in request body" });
      return;
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
      JSON.stringify(
        {
          problemas: diagnostico.problemas,
          protocolo: protocoloGerado,
          comparacao: comparacaoFinal,
        },
        null,
        2,
      ),
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

    let parsed: unknown = null;
    const candidate = extractJsonCandidate(raw);

    if (candidate) {
      try {
        parsed = JSON.parse(candidate);
      } catch {
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
  } catch (err: any) {
    const raw = err?.message ? String(err.message) : "Unknown error";
    res.status(500).json({ data: fallbackData(), raw });
  }
});

app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({
        error: "Nenhum arquivo enviado",
      });
    }

    const textos: string[] = [];

    for (const file of files) {
      const text = file.buffer.toString("utf-8");
      textos.push(text);
    }

    const hash = gerarHash(Buffer.concat(files.map((f) => f.buffer)));

    return res.json({ textos, hash });

  } catch (err: any) {
    return res.status(500).json({
      error: err?.message ?? "Erro upload",
    });
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});
