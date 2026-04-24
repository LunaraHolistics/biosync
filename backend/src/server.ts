// src/server.ts
console.log("🚀 SERVER ATIVO - Iniciando BioSync Backend...");

import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import express from "express";
import cors from "cors";
import { createHash } from "crypto";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import { Request } from "express";

// ✅ Import do cliente Supabase configurado (com IPv4 fix + singleton)
import { supabase } from './config/supabase';

// Parsers e serviços
import { parseHtmReport } from "./utils/parserHtml";
import { gerarDiagnostico, type Diagnostico } from "./services/diagnostico.service";
import { compararExames } from "./services/comparador.service";
import { gerarPlanoTerapeutico } from "./services/motorTerapias.service";

import uploadRouter from "./routes/upload";
import analyzeRoute from "./routes/analyze";

// --- Tipagens ---
type AiStructuredData = {
  interpretacao: string;
  pontos_criticos: string[];
  frequencia_lunara: string;
  justificativa: string;
  plano_terapeutico: any;
  diagnostico?: Diagnostico;
};

// --- Fallback ---
function fallbackData(): AiStructuredData {
  return {
    interpretacao: "Não foi possível gerar análise completa.",
    pontos_criticos: [],
    frequencia_lunara: "N/A",
    justificativa: "Erro na interpretação automática.",
    plano_terapeutico: {
      tipo: "semanal",
      terapias: [],
    },
    diagnostico: {
      problemas: [],
      resumo: { total: 0, alta: 0, media: 0, baixa: 0 },
    },
  };
}

// 🔥 FUNÇÕES AUXILIARES
function normalizeAiData(input: unknown): AiStructuredData {
  const base = fallbackData();
  if (!input || typeof input !== "object") return base;
  const obj = input as any;
  return {
    interpretacao: obj.interpretacao || base.interpretacao,
    pontos_criticos: Array.isArray(obj.pontos_criticos) ? obj.pontos_criticos : [],
    frequencia_lunara: obj.frequencia_lunara || base.frequencia_lunara,
    justificativa: obj.justificativa || base.justificativa,
    plano_terapeutico: base.plano_terapeutico,
    diagnostico: base.diagnostico,
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

// 🔥 MIDDLEWARES ESSENCIAIS (ORDEM IMPORTANTE!)
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// 🔍 DEBUG MIDDLEWARE (remova em produção)
app.use((req, res, next) => {
  if (req.path.includes('/api/analyze')) {
    console.log(`📥 [${new Date().toISOString()}] POST ${req.path}`);
    console.log(`📦 Headers:`, req.headers['content-type']);
    console.log(`🔑 Body keys:`, Object.keys(req.body || {}));
    if (req.body?.prompt) {
      console.log(`📝 Prompt length: ${req.body.prompt.length} chars`);
    }
  }
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

// 🔥 IA + MOTOR TERAPÊUTICO
async function analisarComIA(dados: any): Promise<AiStructuredData> {
  const primeiroResultado = Array.isArray(dados) ? dados[0] : dados;
  const nome = primeiroResultado?.nome || primeiroResultado?.nome_paciente || "Desconhecido";
  const idade = primeiroResultado?.idade || "N/A";
  const sexo = primeiroResultado?.sexo || "N/A";
  const resultado_json = primeiroResultado?.resultado_json || dados;

  const diagnosticoRaw = gerarDiagnostico(dados);
  const diagnostico: Diagnostico = {
    problemas: diagnosticoRaw?.problemas ?? [],
    resumo: diagnosticoRaw?.resumo ?? { total: 0, alta: 0, media: 0, baixa: 0 },
  };

  const plano_terapeutico = gerarPlanoTerapeutico(diagnostico);

  const prompt = `
Você é um especialista em medicina integrativa e análise biossistêmica.

DADOS DO PACIENTE:
- Nome: ${nome}
- Idade: ${idade}
- Sexo: ${sexo}
- Resultados: ${JSON.stringify(resultado_json)}

INSTRUÇÕES PARA A RESPOSTA (obrigatório seguir):
1️⃣ INTERPRETAÇÃO SISTÊMICA (mín. 150 palavras)
2️⃣ PONTOS CRÍTICOS (lista priorizada, máx. 6 itens)
3️⃣ PLANO TERAPÊUTICO (formato JSON estruturado)
4️⃣ FREQUÊNCIA LUNARA + JUSTIFICATIVA
5️⃣ MÉTRICAS DE ACOMPANHAMENTO (3 indicadores)

RESPOSTA EM JSON VÁLIDO, sem texto adicional.
DADOS COMPLETOS: ${JSON.stringify(dados)}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });

    const raw = response.text ?? "";
    let parsed: any = null;
    try {
      const json = extractJsonCandidate(raw);
      parsed = json ? JSON.parse(json) : null;
    } catch (e) {
      console.warn("⚠️ Erro ao parsear JSON da IA:", e);
    }

    const data = normalizeAiData(parsed);
    data.plano_terapeutico = plano_terapeutico;
    data.diagnostico = diagnostico;
    return data;
  } catch (error) {
    console.error("❌ Erro na IA:", error);
    const fallback = fallbackData();
    fallback.plano_terapeutico = plano_terapeutico;
    fallback.diagnostico = diagnostico;
    return fallback;
  }
}

// 🔥 ROTA PRINCIPAL /api/upload
app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const resultados = files.map(file => parseHtmReport(file.buffer));
    const primeiro = resultados[0];
    const nome = primeiro?.nome || "Desconhecido";
    const hash = gerarHash(Buffer.concat(files.map((f) => f.buffer)));

    const { data: exame, error } = await supabase
      .from("exames")
      .insert({
        nome_paciente: nome,
        data_exame: new Date(),
        resultado_json: resultados,
        status: "processando",
      })
      .select()
      .single();

    if (error) throw error;

    const analise = await analisarComIA(resultados);

    await supabase
      .from("exames")
      .update({
        analise_ia: analise,
        pontos_criticos: analise.pontos_criticos,
        plano_terapeutico: analise.plano_terapeutico,
        diagnostico: analise.diagnostico,
        status: "concluido",
      })
      .eq("id", exame.id);

    console.log(`✅ Processado e salvo: ${nome}`);
    res.json({ success: true, exame_id: exame.id, dados: resultados, analise, hash });
  } catch (err: any) {
    console.error("❌ Erro no upload:", err);
    res.status(500).json({ error: err.message || "Erro interno no servidor" });
  }
});

// 🔎 LISTAGEM
app.get("/api/exames", async (_, res) => {
  try {
    const { data, error } = await supabase
      .from("exames")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 🔗 ROTAS EXISTENTES
app.use(uploadRouter);
app.use(analyzeRoute);

// 🔥 HEALTH CHECK
app.get("/health", (_, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`✅ Backend BioSync rodando em http://localhost:${PORT}`);
  console.log(`🔗 Endpoint: http://localhost:${PORT}/api/analyze`);
});

export { app };