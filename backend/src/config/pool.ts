// backend/src/config/pool.ts
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  ssl: { 
    rejectUnauthorized: false 
  },
  // ✅ Timeout para evitar travamentos
  connectionTimeoutMillis: 10000,
  // ✅ Forçar IPv4 via DNS (se necessário no Render)
  // Adicione esta variável no Render: SUPABASE_DB_HOST = seu-host.supabase.co
  host: process.env.SUPABASE_DB_HOST || undefined,
});

// ✅ Teste de conexão opcional
// 🔍 DEBUG: Log da conexão ao iniciar
pool.on('connect', (client) => {
  console.log(`🔗 [POOL] Nova conexão: ${client.connectionParameters.host}:${client.connectionParameters.port}`);
});

pool.on('error', (err) => {
  console.error(`❌ [POOL] Erro de conexão:`, err.message);
});

// Teste inicial de conexão
pool.query('SELECT current_database() as db, inet_server_addr() as host', (err, res) => {
  if (err) {
    console.error('❌ [POOL] Falha ao conectar:', err.message);
  } else {
    console.log(`✅ [POOL] Conectado ao banco: ${res.rows[0].db} em ${res.rows[0].host}`);
  }
});