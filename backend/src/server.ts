import "dotenv/config";
import express from "express";
import cors from "cors";
import { Request, Response, NextFunction } from "express";
import { GoogleGenAI } from "@google/genai";

// Rotas
import examesRouter from "./routes/exames";
import uploadRouter from "./routes/upload";
import analyzeRoute from "./routes/analyze";

// Diagnóstico de ambiente no startup
console.log("🚀 SERVER ATIVO - Iniciando BioSync Backend...");
console.log(`📦 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔑 Variáveis disponíveis: ${Object.keys(process.env).filter(k => !k.startsWith('npm_') && !k.startsWith('NODE_')).join(', ')}`);

// Validação de chaves críticas
const requiredKeys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'APP_SECRET_KEY'];
const missingKeys = requiredKeys.filter(key => !process.env[key]);

if (missingKeys.length > 0) {
  console.error(`❌ ERRO CRÍTICO: Variáveis de ambiente ausentes: ${missingKeys.join(', ')}`);
  console.error('📝 Verifique o arquivo .env em backend/.env');
  process.exit(1);
}

// Inicializar Google AI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Teste de conexão com Gemini (assíncrono, não bloqueia startup)
ai.models.generateContent({
  model: "gemini-1.5-flash",
  contents: "ping",
}).then(() => {
  console.log("✅ Gemini: Conexão estabelecida com sucesso");
}).catch((err) => {
  console.error("❌ Gemini: Falha na conexão -", err.message);
});

// --- APP ---
const app = express();

// 🔥 MIDDLEWARES (ORDEM CRÍTICA)

// 1. CORS - Aceitar extensão Chrome e frontend Vite
app.use(cors({
  origin: [
    'http://localhost:5173',      // Vite dev
    'http://localhost:3000',      // Backend local
    'https://biosync-nu.vercel.app',  // Frontend produção
    'chrome-extension://*',       // Extensão Chrome (qualquer ID)
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

// 2. Body parsers
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// 3. Middleware de Request ID e logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  (req as any).requestId = requestId;
  
  const start = Date.now();
  
  // Log de requisições para rotas de API
  if (req.path.startsWith('/api')) {
    console.log(`\n🆔 [${requestId}] ${req.method} ${req.path}`);
    console.log(`🌐 Origin: ${req.headers.origin || 'N/A'}`);
    
    if (req.body && Object.keys(req.body).length > 0) {
      console.log(`📦 Body keys: ${Object.keys(req.body).join(', ')}`);
    }
  }
  
  // Override do res.json para logar resposta
  const originalJson = res.json.bind(res);
  res.json = function(data: any) {
    if (req.path.startsWith('/api')) {
      const duration = Date.now() - start;
      const status = res.statusCode;
      const statusEmoji = status >= 200 && status < 300 ? '✅' : '❌';
      
      console.log(`${statusEmoji} [${requestId}] ${req.method} ${req.path} - ${status} (${duration}ms)`);
      
      if (data?.error) {
        console.error(`❌ [${requestId}] Erro:`, data.error);
      }
    }
    return originalJson(data);
  };
  
  next();
});

// 🔗 ROTAS

// Health check (público)
app.get("/health", async (req, res) => {
  try {
    const { supabase } = await import('./config/supabase');
    const { data, error } = await supabase
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

// Rota raiz (teste simples)
app.get("/", (req, res) => {
  res.json({
    service: "BioSync Backend",
    version: "2.0",
    status: "running",
    endpoints: {
      health: "/health",
      exames: "/api/exames",
      upload: "/api/upload",
      analyze: "/api/analyze"
    }
  });
});

// Rotas de API (protegidas)
app.use("/api/exames", examesRouter);
app.use(uploadRouter);
app.use(analyzeRoute);

// 🔥 ERROR HANDLER GLOBAL
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  const requestId = (req as any).requestId || 'N/A';
  
  console.error(`\n❌ [${requestId}] ERRO GLOBAL:`);
  console.error(`   Path: ${req.method} ${req.path}`);
  console.error(`   Message: ${err.message}`);
  if (process.env.NODE_ENV === 'development') {
    console.error(`   Stack:`, err.stack);
  }
  
  res.status(500).json({
    error: "Erro interno do servidor",
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    requestId,
    timestamp: new Date().toISOString()
  });
});

// 🔥 404 HANDLER
app.use((req, res) => {
  console.log(`⚠️ Rota não encontrada: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: "Rota não encontrada", 
    path: req.path,
    method: req.method
  });
});

// 🔥 INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n✅ Backend BioSync rodando em http://localhost:${PORT}`);
  console.log(`🔗 Endpoints disponíveis:`);
  console.log(`   • GET  /health`);
  console.log(`   • POST /api/exames (protegido)`);
  console.log(`   • GET  /api/exames (protegido)`);
  console.log(`   • GET  /api/exames/:id (protegido)`);
  console.log(`   • POST /api/upload`);
  console.log(`   • POST /api/analyze`);
  console.log(`\n🔐 Autenticação: Header 'x-api-key' com APP_SECRET_KEY`);
});

export { app };