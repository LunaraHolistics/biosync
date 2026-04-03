console.log("SERVER ATIVO");
import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import express from "express";
import cors from "cors";
import { createHash } from "crypto";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

// Parsers e serviços
import { parseHtmReport } from "./utils/parserHtml";
import { parseBioressonancia } from "./utils/parserBio";
import { gerarDiagnostico } from "./services/diagnostico.service";
import { gerarProtocolo } from "./services/motorTerapias.service";
import { compararExames } from "./services/comparador.service";

import uploadRouter from "./routes/upload";
import analyzeRoute from "./routes/analyze";

// 🔥 SUPABASE
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

// --- Funções auxiliares (mantidas) ---
function fallbackData(): AiStructuredData {
  return {
    interpretacao: "Não foi possível gerar análise completa.",
    pontos_criticos: [],
    protocolo: { manha: [], tarde: [], noite: [] },
    frequencia_lunara: "N/A",
    justificativa: "Erro na interpretação automática.",
  };
}

function normalizeAiData(input: unknown): AiStructuredData {
  const base = fallbackData();
  if (!input || typeof input !== "object") return base;

  const obj = input as any;

  return {
    interpretacao: obj.interpretacao || base.interpretacao,
    pontos_criticos: obj.pontos_criticos || [],
    protocolo: obj.protocolo || base.protocolo,
    frequencia_lunara: obj.frequencia_lunara || base.frequencia_lunara,
    justificativa: obj.justificativa || base.justificativa,
  };
}

function extractJsonCandidate(text: string): string | null {
  const match = text.match(/\{[\s\S]*\}/);
  return match?.[0] ?? null;
}

function gerarHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

// --- APP ---
const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

// 🔥 FUNÇÃO CENTRAL DE IA
async function analisarComIA(dados: any) {
  const diagnostico = gerarDiagnostico(dados);
  const protocolo = gerarProtocolo(diagnostico);

  const prompt = `
Analise os dados abaixo como terapeuta integrativo.

Considere:
- desempenho físico
- sono
- metabolismo
- emocional
- energia vital

Responda em JSON:
{
  "interpretacao": string,
  "pontos_criticos": string[],
  "protocolo": { "manha": [], "tarde": [], "noite": [] },
  "frequencia_lunara": string,
  "justificativa": string
}

DADOS:
${JSON.stringify(dados)}
`;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });

  const raw = response.text ?? "";
  const json = extractJsonCandidate(raw);
  const parsed = json ? JSON.parse(json) : null;

  const data = normalizeAiData(parsed);
  data.protocolo = protocolo;

  return data;
}

// 🔥 ROTA PRINCIPAL ATUALIZADA
app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const resultados = [];

    for (const file of files) {
      const dados = parseHtmReport(file.buffer);
      resultados.push(dados);
    }

    const primeiro = resultados[0];
    const nome = primeiro?.nome || "Desconhecido";

    const hash = gerarHash(Buffer.concat(files.map(f => f.buffer)));

    // 💾 SALVAR NO BANCO
    const { data: exame, error } = await supabase
      .from("exames")
      .insert({
        nome_paciente: nome,
        data_exame: new Date(),
        resultado_json: resultados,
        status: "processando"
      })
      .select()
      .single();

    if (error) throw error;

    // 🤖 IA
    const analise = await analisarComIA(resultados).catch(err => {
      console.error("Erro na IA:", err);

      return {
        interpretacao: "IA temporariamente indisponível.",
        pontos_criticos: [],
        protocolo: { manha: [], tarde: [], noite: [] },
        frequencia_lunara: "N/A",
        justificativa: "Falha na análise automática."
      };
    });

    // 💾 ATUALIZAR
    await supabase
      .from("exames")
      .update({
        analise_ia: analise,
        pontos_criticos: analise.pontos_criticos,
        protocolo: JSON.stringify(analise.protocolo),
        status: "concluido"
      })
      .eq("id", exame.id);

    console.log(`Processado e salvo: ${nome}`);

    res.json({
      success: true,
      exame_id: exame.id,
      dados: resultados,
      analise,
      hash
    });

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 🔎 LISTAGEM
app.get("/api/exames", async (_, res) => {
  const { data, error } = await supabase
    .from("exames")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json(error);

  res.json(data);
});

// Rotas existentes (mantidas)
app.use(uploadRouter);
app.use(analyzeRoute);

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Backend BioSync rodando na porta ${PORT}`);
});