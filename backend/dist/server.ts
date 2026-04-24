console.log("SERVER ATIVO");
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import express from "express";
import cors from "cors";
import { createHash } from "crypto";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import { supabase } from '../config/supabase';

// Importando os parsers e serviços
import { parseHtmReport } from "./utils/parserHtml";
import { parseBioressonancia } from "./utils/parserBio";
import { gerarDiagnostico } from "./services/diagnostico.service";
import { gerarProtocolo } from "./services/motorTerapias.service";
import { compararExames } from "./services/comparador.service";

// Importando as rotas externas se houver
import uploadRouter from "./routes/upload";
import analyzeRoute from "./routes/analyze";

// --- SUPABASE ---
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
    if (!origin || origin === 'null') {
      return callback(null, true);
    }
    callback(null, true);
  }
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Configuração do Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// --- IA ---
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

// --- FUNÇÃO DE ANÁLISE CENTRAL (REUTILIZÁVEL) ---
async function analisarComGemini(dadosProcessados: any) {
  const diagnostico = gerarDiagnostico(dadosProcessados);
  const protocoloGerado = gerarProtocolo(diagnostico);

  const structuredPrompt = `
Você é um terapeuta holístico integrativo, com linguagem acessível, acolhedora e profunda.

Seu objetivo é traduzir dados técnicos em uma leitura clara, humana e útil para o paciente, sem excesso de termos difíceis.

Analise os dados abaixo considerando o ser humano de forma integral:

- Corpo físico (energia, metabolismo, funcionamento orgânico)
- Estado emocional (estresse, ansiedade, humor)
- Campo espiritual/energético (sensibilidade, bloqueios, vitalidade)
- Desempenho físico (disposição, força, resistência)
- Interferência social (impacto emocional nas relações, isolamento, irritabilidade)

Identifique padrões, conexões entre sistemas e possíveis causas raízes.

---

Responda em JSON no seguinte formato:

{
  "interpretacao": string,
  "analise_setores": {
    "fisico": string,
    "emocional": string,
    "espiritual": string,
    "desempenho": string,
    "social": string
  },
  "pontos_criticos": string[],
  "plano_terapeutico": {
    "tipo": "semanal" | "quinzenal" | "mensal",
    "terapias": [
      {
        "nome": string,
        "descricao": string,
        "como_ajuda": string,
        "frequencia": string
      }
    ]
  },
  "frequencia_lunara": string,
  "justificativa": string
}

---

REGRAS IMPORTANTES:

- Evite linguagem técnica excessiva. Explique como se estivesse falando diretamente com o paciente.
- Seja profundo, mas claro.
- Conecte sintomas físicos com emocionais e energéticos.
- A análise deve trazer sensação de entendimento e direção.
- No plano terapêutico:
  - explique o que cada terapia faz
  - explique por que ela foi escolhida
  - explique como ela pode ajudar na prática

---

DADOS:
${JSON.stringify(dadosProcessados)}
`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: structuredPrompt,
  });

  const raw = response.text ?? "";
  const candidate = extractJsonCandidate(raw);
  const parsed = candidate ? JSON.parse(candidate) : null;

  const data = normalizeAiData(parsed);
  data.protocolo = protocoloGerado;

  return data;
}

// --- ROTAS ---

app.get("/health", (_, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 🔥 UPLOAD COM PERSISTÊNCIA + IA
app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const resultadosProcessados = [];

    for (const file of files) {
      const dadosExtraidos = parseHtmReport(file.buffer);
      resultadosProcessados.push(dadosExtraidos);
    }

    const hash = gerarHash(Buffer.concat(files.map((f) => f.buffer)));

    const primeiro = resultadosProcessados[0];
    const nomePaciente = primeiro?.nome || "Desconhecido";

    // 💾 SALVA EXAME
    const { data: exame, error } = await supabase
      .from("exames")
      .insert([
        {
          nome_paciente: nomePaciente,
          data_exame: new Date(),
          resultado_json: resultadosProcessados,
          status: "processando",
        },
      ])
      .select()
      .single();

    if (error) throw error;

    // 🤖 IA
    const analise = await analisarComGemini(resultadosProcessados);

    // 💾 ATUALIZA COM RESULTADO
    await supabase
      .from("exames")
      .update({
        analise_ia: analise,
        protocolo: JSON.stringify(analise.protocolo),
        pontos_criticos: analise.pontos_criticos,
        status: "concluido",
      })
      .eq("id", exame.id);

    console.log(`Processado e salvo: ${nomePaciente}`);

    return res.json({
      success: true,
      exame_id: exame.id,
      dados: resultadosProcessados,
      analise,
      hash,
    });

  } catch (err: any) {
    console.error("Erro no upload:", err);

    return res.status(500).json({
      error: err?.message ?? "Erro interno",
    });
  }
});

// 📊 LISTAGEM (para frontend)
app.get("/api/exames", async (_, res) => {
  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json(error);

  res.json(data);
});

// Outras rotas
app.use(uploadRouter);
app.use(analyzeRoute);

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Backend BioSync rodando na porta ${PORT}`);
});