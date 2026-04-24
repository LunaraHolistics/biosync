// backend/src/config/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Forçar IPv4 para compatibilidade com Render
const urlWithIPv4 = supabaseUrl.includes('?') 
  ? `${supabaseUrl}&ipv4=true` 
  : `${supabaseUrl}?ipv4=true`;

export const supabase = createClient(urlWithIPv4, supabaseKey, {
  auth: { persistSession: false }
});