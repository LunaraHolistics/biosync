// backend/src/config/pool.ts
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  ssl: { 
    rejectUnauthorized: false 
  },
  // Timeouts para evitar conexões penduradas
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

// Log de erro global do pool (seguro e útil)
pool.on('error', (err) => {
  console.error('❌ [POOL] Erro inesperado:', err.message);
});

// ✅ Teste de conexão simples ao iniciar (sem acessar propriedades internas)
pool.query('SELECT NOW() as connected_at', (err, res) => {
  if (err) {
    console.error('❌ [POOL] Falha ao conectar no banco:', err.message);
  } else {
    console.log(`✅ [POOL] Conectado ao PostgreSQL em ${res.rows[0].connected_at}`);
  }
});