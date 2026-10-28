import "dotenv/config"; // <-- ADICIONE ESTA LINHA NO TOPO
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Validação de segurança para não deixar passar em branco
if (!supabaseUrl || !supabaseKey) {
  console.error("ERRO CRÍTICO: Variáveis do Supabase não encontradas no .env");
  console.error("SUPABASE_URL existe?", !!supabaseUrl);
  console.error("SUPABASE_SERVICE_ROLE_KEY existe?", !!supabaseKey);
  process.exit(1); // Mata o servidor se as chaves não existirem
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: {
    headers: {
      apiKey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    }
  }
});