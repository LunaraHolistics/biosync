// backend/src/config/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }, // Backend não precisa de sessão
  global: {
    headers: {
      apiKey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    }
  }
  // ✅ O cliente JS já lida com IPv4/IPv6 automaticamente
});