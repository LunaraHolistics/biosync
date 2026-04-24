// backend/src/db/exames.repository.ts

// ✅ IMPORTAR o cliente Supabase JS (já configurado com IPv4 fix + tratamento de reconexão)
import { supabase } from '../config/supabase';

// ============================================================================
// 🔄 ATUALIZAR EXAME COM BIOSYNC
// ============================================================================

/**
 * Atualiza um exame existente com os resultados da engine BioSync
 * Usa Supabase JS client para evitar erros de conexão IPv6 no Render
 */
export async function atualizarExameComBioSync(
  exameId: string,
  biosyncResult: {
    modo_selecionado: string;
    category_scores: Record<string, number>;
    critical_alerts: Array<{ item: string; score: number; impact: string }>;
    quick_wins: Array<{ item: string; action: string; expected: string }>;
    imc_value: number | null;
    imc_status: string | null;
    suggested_protocol: { therapies: string[]; checklist: string[]; timeline: string };
    translated_items?: Array<{ raw: string; client_term: string; trainer_term: string }>;
  }
) {
  try {
    console.log(`\n💾 [Supabase JS] Salvando exame: ${exameId}`);

    // 🔍 Log do payload antes de enviar
    console.log(`📦 [Supabase JS] Payload keys: ${Object.keys(biosyncResult).join(', ')}`);
    console.log(`📊 [Supabase JS] category_scores: ${JSON.stringify(biosyncResult.category_scores)}`);
    console.log(`🚨 [Supabase JS] critical_alerts count: ${biosyncResult.critical_alerts?.length || 0}`);

    // ✅ Montar payload para indice_biosync (objeto JS puro)
    const indiceBiosyncPayload = {
      category_scores: biosyncResult.category_scores,
      critical_alerts: biosyncResult.critical_alerts,
      quick_wins: biosyncResult.quick_wins,
      imc: { value: biosyncResult.imc_value, status: biosyncResult.imc_status },
      protocol: biosyncResult.suggested_protocol,
      translated_items: biosyncResult.translated_items || [],
      processed_at: new Date().toISOString()
    };

    // ✅ Usar cliente Supabase JS para UPDATE (já tem IPv4 fix + reconexão automática)
    const { data, error } = await supabase
      .from('exames')
      .update({
        status: 'concluido',
        indice_biosync: indiceBiosyncPayload,
        updated_at: new Date().toISOString()
      })
      .eq('id', exameId)
      .select('id, status, updated_at, indice_biosync')
      .maybeSingle();

    if (error) {
      console.error(`❌ [Supabase JS] Erro ao atualizar:`, {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }

    if (!data) {
      console.error(`❌ [Supabase JS] Nenhuma linha atualizada para exameId: ${exameId}`);
      throw new Error(`Exame não encontrado ou não atualizado: ${exameId}`);
    }

    console.log(`✅ [Supabase JS] Exame atualizado: ${data.id}`);
    console.log(`📊 [Supabase JS] Status: ${data.status}`);
    console.log(`🕐 [Supabase JS] Updated at: ${data.updated_at}`);
    
    if (data.indice_biosync?.category_scores) {
      console.log(`📈 [Supabase JS] Scores salvos: ${JSON.stringify(data.indice_biosync.category_scores)}`);
    }

    return data;

  } catch (err: any) {
    console.error(`❌ [Supabase JS] ERRO CRÍTICO em atualizarExameComBioSync:`, {
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
    throw err;
  }
}

// ============================================================================
// 🔍 BUSCAR EXAME COM BIOSYNC
// ============================================================================

/**
 * Busca exame por ID com todos os dados do BioSync
 * Pode usar pool ou Supabase client - aqui mantemos pool para leitura (funciona)
 */
export async function buscarExameComBioSync(exameId: string) {
  try {
    console.log(`🔍 [DB] Buscando exame: ${exameId}`);

    const { data, error } = await supabase
      .from('exames')
      .select(`
        id,
        nome_paciente,
        cliente_id,
        resultado_json,
        analise_ia,
        indice_biosync,
        pontos_criticos,
        plano_terapeutico,
        status,
        created_at,
        updated_at
      `)
      .eq('id', exameId)
      .maybeSingle();

    if (error) {
      console.error('❌ [Supabase JS] Erro ao buscar exame:', {
        message: error.message,
        code: error.code
      });
      throw error;
    }

    if (data) {
      console.log(`✅ [Supabase JS] Exame encontrado: ${data.id} | status: ${data.status}`);
    } else {
      console.warn(`⚠️ [Supabase JS] Exame não encontrado: ${exameId}`);
    }

    return data;

  } catch (error: any) {
    console.error('❌ [Supabase JS] ERRO em buscarExameComBioSync:', {
      message: error.message,
      code: error.code
    });
    throw error;
  }
}

// ============================================================================
// 🔧 FUNÇÕES AUXILIARES INTERNAS
// ============================================================================

function calculateOverallScore(scores: Record<string, number>): number {
  const values = Object.values(scores).filter(v => typeof v === 'number' && v > 0);
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function generateSummary(result: any): string {
  try {
    const lowScores = Object.entries(result.category_scores || {})
      .filter(([_, v]: [string, any]) => typeof v === 'number' && v < 50)
      .map(([k, _]: [string, any]) => k);
    
    if (lowScores.length === 0) return "Perfil bioenergético equilibrado.";
    return `Atenção em: ${lowScores.join(', ')}. ${result.critical_alerts?.[0]?.impact || ''}`;
  } catch {
    return "Análise bioenergética concluída.";
  }
}