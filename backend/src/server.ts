// src/server.ts
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
import { gerarDiagnostico, type Diagnostico } from "./services/diagnostico.service";
import { compararExames } from "./services/comparador.service";
import { gerarPlanoTerapeutico } from "./services/motorTerapias.service";

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
      resumo: {
        total: 0,
        alta: 0,
        media: 0,
        baixa: 0,
      },
    },
  };
}

// 🔥 FUNÇÕES AUXILIARES (FORA DO FALLBACK)
function normalizeAiData(input: unknown): AiStructuredData {
  const base = fallbackData();
  if (!input || typeof input !== "object") return base;

  const obj = input as any;

  return {
    interpretacao: obj.interpretacao || base.interpretacao,
    pontos_criticos: obj.pontos_criticos || [],
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

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
});

// 🔥 IA + MOTOR TERAPÊUTICO
async function analisarComIA(dados: any): Promise<AiStructuredData> {
  // 🔧 Extrair dados do paciente dos resultados (CORREÇÃO PRINCIPAL)
  const primeiroResultado = Array.isArray(dados) ? dados[0] : dados;
  const nome = primeiroResultado?.nome || primeiroResultado?.nome_paciente || "Desconhecido";
  const idade = primeiroResultado?.idade || "N/A";
  const sexo = primeiroResultado?.sexo || "N/A";
  const resultado_json = primeiroResultado?.resultado_json || dados;

  const diagnosticoRaw = gerarDiagnostico(dados);

  const diagnostico: Diagnostico = {
    problemas: diagnosticoRaw?.problemas ?? [],
    resumo: diagnosticoRaw?.resumo ?? {
      total: 0,
      alta: 0,
      media: 0,
      baixa: 0,
    },
  };

  const plano_terapeutico = gerarPlanoTerapeutico(diagnostico);

  // 🔧 Template string corrigido (tudo dentro de um único bloco)
  const prompt = `
Você é um especialista em medicina integrativa e análise biossistêmica.

DADOS DO PACIENTE:
- Nome: ${nome}
- Idade: ${idade}
- Sexo: ${sexo}
- Resultados: ${JSON.stringify(resultado_json)}

INSTRUÇÕES PARA A RESPOSTA (obrigatório seguir):

1️⃣ INTERPRETAÇÃO SISTÊMICA (mín. 150 palavras):
   - Identifique o eixo primário de desequilíbrio (ex: Intestino-Cérebro-Coração)
   - Explique a cascata fisiopatológica: como um desequilíbrio gera o próximo
   - Conecte com sintomas clínicos prováveis (mesmo que não relatados)
   - Mencione fatores ambientais/alimentares agravantes

2️⃣ PONTOS CRÍTICOS (lista priorizada):
   - Máx. 6 itens
   - Formato: "[SISTEMA] Problema específico → Impacto clínico"
   - Ex: "[INTESTINO] Disbiose com redução de butirato → Inflamação sistêmica de baixo grau"

3️⃣ PLANO TERAPÊUTICO (obrigatório preencher):
   {
     "tipo": "semanal" | "quinzenal" | "mensal",
     "terapias": [
       {
         "nome": "Nome da terapia/suplemento/intervenção",
         "categoria": "nutricional" | "frequencial" | "comportamental" | "ambiental",
         "dosagem_frequencia": "Ex: 500mg 2x/dia OU 15min diários",
         "justificativa_mecanica": "Por que isso funciona no contexto deste paciente",
         "prioridade": 1-3 (1 = essencial)
       }
     ]
   }

4️⃣ FREQUÊNCIA LUNARA + JUSTIFICATIVA:
   - Escolha UMA frequência com base no eixo afetado
   - Justifique em 2-3 frases conectando com a fisiologia do paciente

5️⃣ MÉTRICAS DE ACOMPANHAMENTO:
   - Liste 3 indicadores objetivos para reavaliar em 30-60 dias

RESPOSTA EM JSON VÁLIDO, sem texto adicional.

DADOS COMPLETOS PARA ANÁLISE:
${JSON.stringify(dados)}
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
      console.warn("Erro ao parsear JSON da IA:", e);
    }

    const data = normalizeAiData(parsed);
    data.plano_terapeutico = plano_terapeutico;
    data.diagnostico = diagnostico;

    return data;
  } catch (error) {
    console.error("Erro na IA:", error);
    const fallback = fallbackData();
    fallback.plano_terapeutico = plano_terapeutico;
    fallback.diagnostico = diagnostico;
    return fallback;
  }
}

// 🔥 ROTA PRINCIPAL
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

    const hash = gerarHash(Buffer.concat(files.map((f) => f.buffer)));

    // 💾 SALVAR INICIAL
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

    // 🤖 IA + PLANO
    const analise = await analisarComIA(resultados);

    // 💾 ATUALIZAR COM RESULTADO
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

    console.log(`Processado e salvo: ${nome}`);

    res.json({
      success: true,
      exame_id: exame.id,
      dados: resultados,
      analise,
      hash,
    });
  } catch (err: any) {
    console.error("Erro no upload:", err);
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

// Rotas existentes
app.use(uploadRouter);
app.use(analyzeRoute);

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Backend BioSync rodando na porta ${PORT}`);
});

export { app }; // ✅ para testes