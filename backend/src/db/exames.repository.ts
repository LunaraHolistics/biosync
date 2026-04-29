// backend/src/db/exames.repository.ts

// ✅ IMPORTAR o cliente Supabase JS (já configurado com IPv4 fix + tratamento de reconexão)
import { supabase } from '../config/supabase';

// ============================================================================
// 📦 TIPOS AUXILIARES PARA EVOLUÇÃO
// ============================================================================

export type ItemScoreEvolucao = {
  item: string;
  categoria: string;
  score: number;
  status: 'baixo' | 'normal' | 'alto';
  impacto: string;
  impacto_fitness?: {
    performance?: string;
    hipertrofia?: string;
    emagrecimento?: string;
    recuperacao?: string;
    humor?: string;
  };
};

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
    // 🔥 NOVO: Matches da engine para histórico de evolução por item
    matches?: Array<{
      itemBase: string;
      categoria: string;
      score?: number;
      gravidade: 'baixo' | 'normal' | 'alto';
      impacto: string;
      impacto_fitness?: ItemScoreEvolucao['impacto_fitness'];
    }>;
    // 🔥 NOVO: item_scores pré-calculados (opcional - se já vierem do analyze.ts)
    item_scores?: ItemScoreEvolucao[];
  }
) {
  try {
    console.log(`\n💾 [Supabase JS] Salvando exame: ${exameId}`);

    // 🔍 Log do payload antes de enviar
    console.log(`📦 [Supabase JS] Payload keys: ${Object.keys(biosyncResult).join(', ')}`);
    console.log(`📊 [Supabase JS] category_scores: ${JSON.stringify(biosyncResult.category_scores)}`);
    console.log(`🚨 [Supabase JS] critical_alerts count: ${biosyncResult.critical_alerts?.length || 0}`);

    // 🔥 NOVO: Calcular item_scores para histórico de evolução (se não vierem prontos)
    const itemScores = biosyncResult.item_scores || biosyncResult.matches?.map((m) => ({
      item: m.itemBase,
      categoria: m.categoria,
      score: m.score ?? 50, // Se não tiver score calculado, usa 50 como base neutra
      status: m.gravidade,
      impacto: m.impacto,
      impacto_fitness: m.impacto_fitness
    })) || [];

    console.log(`📈 [Supabase JS] item_scores salvos: ${itemScores.length} itens`);

    // ✅ Montar payload para indice_biosync (objeto JS puro)
    const indiceBiosyncPayload = {
      category_scores: biosyncResult.category_scores,
      critical_alerts: biosyncResult.critical_alerts,
      quick_wins: biosyncResult.quick_wins,
      imc: { value: biosyncResult.imc_value, status: biosyncResult.imc_status },
      protocol: biosyncResult.suggested_protocol,
      translated_items: biosyncResult.translated_items || [],
      processed_at: new Date().toISOString(),
      // 🔥 NOVO: Scores por item para comparação histórica
      item_scores: itemScores
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
    if (data.indice_biosync?.item_scores?.length) {
      console.log(`📊 [Supabase JS] Item scores salvos: ${data.indice_biosync.item_scores.length} itens`);
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
      
      // 🔍 Debug: mostrar se tem item_scores
      if (data.indice_biosync?.item_scores?.length) {
        console.log(`📊 [DB] item_scores disponíveis: ${data.indice_biosync.item_scores.length} itens`);
      }
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
// 📊 UTILITÁRIOS DE EVOLUÇÃO (para comparação entre exames)
// ============================================================================

/**
 * Compara item_scores de dois exames e calcula tendências
 */
export function calcularTendenciaItem(
  scoreAtual: number,
  scoreAnterior: number | null
): 'melhorou' | 'piorou' | 'estavel' | 'novo' {
  if (scoreAnterior === null) return 'novo';
  
  const delta = scoreAtual - scoreAnterior;
  if (delta >= 10) return 'melhorou';
  if (delta <= -10) return 'piorou';
  return 'estavel';
}

/**
 * Gera resumo estatístico da evolução entre exames
 */
export function gerarResumoEvolucao(itensEvolucao: Array<{ trend: string }>) {
  const melhoraram = itensEvolucao.filter(i => i.trend === 'melhorou').length;
  const pioraram = itensEvolucao.filter(i => i.trend === 'piorou').length;
  const estaveis = itensEvolucao.filter(i => i.trend === 'estavel').length;
  const novos = itensEvolucao.filter(i => i.trend === 'novo').length;
  
  return {
    total: itensEvolucao.length,
    melhoraram,
    pioraram,
    estaveis,
    novos,
    percentual_melhora: itensEvolucao.length > 0 
      ? Math.round((melhoraram / itensEvolucao.length) * 100) 
      : 0
  };
}

// ============================================================================
// 🔧 FUNÇÕES AUXILIARES INTERNAS (LEGACY)
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