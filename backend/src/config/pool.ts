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
pool.on('error', (err) => {
  console.error('❌ Erro inesperado no pool PostgreSQL:', err);
});