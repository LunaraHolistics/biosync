// src/server.ts
console.log("🚀 SERVER ATIVO - Iniciando BioSync Backend...");

import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

import express from "express";
import cors from "cors";
import { createHash } from "crypto";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import { Request, Response, NextFunction } from "express";

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

// 🔥 NOVO: Tipagem para resposta de debug da rota /api/analyze
type AnalyzeDebugResponse = {
  success: boolean;
  data: AiStructuredData;
  meta: {
    total_items: number;
    valid_items: number;
    processing_time_ms: number;
    modo: string;
    request_id: string;
  };
  debug: {
    parser_ok: boolean;
    engine_ok: boolean;
    saved: boolean;
    matches_count: number;
    item_scores_count: number;
    scores_varied: boolean;
    html_fallback_used: boolean;
    [key: string]: any;
  };
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

// 🔥 VALIDAÇÃO DE PAYLOAD PARA /api/analyze
function validarPayloadAnalyze(body: any): { valido: boolean; erros: string[] } {
  const erros: string[] = [];
  
  if (!body.prompt || typeof body.prompt !== 'string') {
    erros.push('prompt ausente ou inválido');
  } else if (body.prompt.trim().length < 50) {
    erros.push('prompt muito curto (mínimo 50 caracteres)');
  }
  
  if (body.exame_id && typeof body.exame_id !== 'string') {
    erros.push('exame_id deve ser string');
  }
  
  if (body.modo_analise && !['fitness', 'weight_loss', 'emotional_sleep', 'immunity', 'mental'].includes(body.modo_analise)) {
    erros.push('modo_analise inválido');
  }
  
  return { valido: erros.length === 0, erros };
}

// --- APP ---
const app = express();

// 🔥 MIDDLEWARES ESSENCIAIS (ORDEM IMPORTANTE!)
app.use(cors({
  origin: process.env.FRONTEND_URL?.split(',') || ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// 🔍 DEBUG MIDDLEWARE EXPANDIDO
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  // Log para rotas de análise
  if (req.path.includes('/api/analyze') || req.path.includes('/api/upload')) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    (req as any).requestId = requestId;
    
    console.log(`\n🆔 [${requestId}] === NOVA REQUISIÇÃO ===`);
    console.log(`📥 [${new Date().toISOString()}] ${req.method} ${req.path}`);
    console.log(`🌐 Origin: ${req.headers.origin || 'N/A'}`);
    console.log(`📦 Content-Type: ${req.headers['content-type']}`);
    
    if (req.body && Object.keys(req.body).length > 0) {
      console.log(`🔑 Body keys: ${Object.keys(req.body).join(', ')}`);
      if (req.body.exame_id) console.log(`🆔 exame_id: ${req.body.exame_id}`);
      if (req.body.modo_analise) console.log(`🎯 modo_analise: ${req.body.modo_analise}`);
      if (req.body.prompt) console.log(`📝 Prompt length: ${req.body.prompt.length} chars`);
      if (req.body.peso_cliente) console.log(`⚖️ peso: ${req.body.peso_cliente}kg`);
      if (req.body.altura_cliente_metros) console.log(`📏 altura: ${req.body.altura_cliente_metros}m`);
    }
  }
  
  // Override do res.json para logar resposta
  const originalJson = res.json.bind(res);
  res.json = function(data: any) {
    if (req.path.includes('/api/analyze') || req.path.includes('/api/upload')) {
      const duration = Date.now() - start;
      const requestId = (req as any).requestId || 'N/A';
      
      console.log(`📤 [${requestId}] Resposta em ${duration}ms`);
      
      // Log de debug específico para /api/analyze
      if (req.path.includes('/api/analyze') && data?.debug) {
        const debug = data.debug;
        console.log(`🔍 [${requestId}] Debug da análise:`);
        console.log(`   • parser_ok: ${debug.parser_ok}`);
        console.log(`   • engine_ok: ${debug.engine_ok}`);
        console.log(`   • saved: ${debug.saved}`);
        console.log(`   • matches_count: ${debug.matches_count}`);
        console.log(`   • item_scores_count: ${debug.item_scores_count}`);
        console.log(`   • scores_varied: ${debug.scores_varied}`);
        console.log(`   • html_fallback_used: ${debug.html_fallback_used}`);
        
        // Alerta se scores não estiverem variados
        if (!debug.scores_varied && debug.item_scores_count > 0) {
          console.warn(`⚠️ [${requestId}] ALERTA: Todos os scores são 50! Verificar lógica de cálculo.`);
        }
      }
      
      // Log de erro se houver
      if (data?.error) {
        console.error(`❌ [${requestId}] Erro na resposta:`, data.error);
        if (data.details) console.error(`📋 Details:`, data.details);
      }
    }
    return originalJson(data);
  };
  
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

// 🔥 HEALTH CHECK EXPANDIDO
app.get("/health", async (req, res) => {
  try {
    // Testar conexão com Supabase
    const {  healthCheck, error } = await supabase
      .from('exames')
      .select('id')
      .limit(1);
    
    const supabaseStatus = error ? '❌ Falha' : '✅ OK';
    
    res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      services: {
        supabase: supabaseStatus,
        gemini: process.env.GEMINI_API_KEY ? '✅ Configurado' : '❌ Ausente'
      },
      uptime: process.uptime()
    });
  } catch (err: any) {
    res.status(500).json({ 
      status: "error", 
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 🔥 ROTA DE DEBUG PARA TESTAR /api/analyze DIRETAMENTE
app.post("/api/debug/analyze", async (req: Request, res: Response) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  console.log(`🔧 [${requestId}] Rota de debug acionada`);
  
  try {
    // Validar payload
    const { valido, erros } = validarPayloadAnalyze(req.body);
    if (!valido) {
      console.warn(`⚠️ [${requestId}] Payload inválido:`, erros);
      return res.status(400).json({ 
        error: "Payload inválido", 
        erros,
        requestId 
      });
    }
    
    // Encaminhar para a rota principal de análise
    // Isso permite testar /api/analyze com logs detalhados
    req.path = '/api/analyze';
    req.url = '/api/analyze';
    
    // Chamar o router de analyze manualmente
    analyzeRoute.handle(req, res, (err: any) => {
      if (err) {
        console.error(`❌ [${requestId}] Erro no debug:`, err);
        res.status(500).json({ error: err.message, requestId });
      }
    });
    
  } catch (error: any) {
    console.error(`❌ [${requestId}] Erro no debug:`, error);
    res.status(500).json({ 
      error: "Erro interno no debug", 
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      requestId 
    });
  }
});

// 🔥 ERROR HANDLER GLOBAL
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  const requestId = (req as any).requestId || 'N/A';
  console.error(`❌ [${requestId}] ERRO GLOBAL:`, {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method
  });
  
  res.status(500).json({
    error: "Erro interno no servidor",
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    requestId,
    timestamp: new Date().toISOString()
  });
});

// 🔥 404 HANDLER
app.use((req, res) => {
  console.log(`⚠️ Rota não encontrada: ${req.method} ${req.path}`);
  res.status(404).json({ error: "Rota não encontrada", path: req.path });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`✅ Backend BioSync rodando em http://localhost:${PORT}`);
  console.log(`🔗 Endpoint: http://localhost:${PORT}/api/analyze`);
  console.log(`🔧 Debug: http://localhost:${PORT}/api/debug/analyze`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
});

export { app };