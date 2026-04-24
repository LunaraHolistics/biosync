// backend/src/db/exames.repository.ts
import { pool } from '../config/pool'; // ✅ Import do pool, não do supabase client

/**
 * Atualiza um exame existente com os resultados da engine BioSync
 */
// backend/src/db/exames.repository.ts

// backend/src/db/exames.repository.ts

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
    console.log(`\n💾 [DB] INICIANDO SAVE - exameId: ${exameId}`);
    
    // 🔍 Log do payload ANTES de enviar
    console.log(`📦 [DB] Payload keys: ${Object.keys(biosyncResult).join(', ')}`);
    console.log(`📊 [DB] category_scores: ${JSON.stringify(biosyncResult.category_scores)}`);
    console.log(`🚨 [DB] critical_alerts count: ${biosyncResult.critical_alerts?.length || 0}`);

    // ✅ Montar payload para indice_biosync (objeto JS puro, SEM stringify)
    const indiceBiosyncPayload = {
      category_scores: biosyncResult.category_scores,
      critical_alerts: biosyncResult.critical_alerts,
      quick_wins: biosyncResult.quick_wins,
      imc: { value: biosyncResult.imc_value, status: biosyncResult.imc_status },
      protocol: biosyncResult.suggested_protocol,
      translated_items: biosyncResult.translated_items || [],
      processed_at: new Date().toISOString()
    };

    // 🔍 Log da query que será executada
    console.log(`🔍 [DB] Executando: UPDATE exames SET status='concluido', indice_biosync=..., updated_at=now() WHERE id='${exameId}'`);

    // ✅ Executar UPDATE (objeto direto, pg serializa automaticamente para JSONB)
    const res = await pool.query(
  `
  BEGIN;
  UPDATE exames
  SET 
    status = 'concluido',
    indice_biosync = $1,
    updated_at = now()
  WHERE id = $2;
  COMMIT;
  SELECT id, status, updated_at, indice_biosync FROM exames WHERE id = $2;
  `,
  [indiceBiosyncPayload, exameId]
);

    // 🔍 Log do resultado da query
    console.log(`📊 [DB] Query result: rowCount=${res.rowCount}, rows length=${res.rows?.length}`);

    // ✅ Validar que pelo menos uma linha foi afetada
    if (!res.rows || res.rows.length === 0) {
      // 🔍 Verificar se o exame existe
      const check = await pool.query('SELECT id, status, updated_at FROM exames WHERE id = $1', [exameId]);
      if (check.rows.length === 0) {
        console.error(`❌ [DB] Exame NÃO ENCONTRADO: ${exameId}`);
        throw new Error(`Exame não existe: ${exameId}`);
      } else {
        console.error(`❌ [DB] UPDATE não retornou linhas. Exame existe com status: ${check.rows[0].status}, updated_at: ${check.rows[0].updated_at}`);
        throw new Error(`UPDATE não afetou linhas para exame ${exameId}`);
      }
    }

    const updated = res.rows[0];
    
    // 🔍 Log do conteúdo salvo
    console.log(`✅ [DB] Exame atualizado: ${updated.id}`);
    console.log(`📊 [DB] Status: ${updated.status}`);
    console.log(`🕐 [DB] Updated at: ${updated.updated_at}`);
    
    if (updated.indice_biosync) {
      const keys = Object.keys(updated.indice_biosync);
      console.log(`🔑 [DB] indice_biosync keys: ${keys.join(', ')}`);
      console.log(`📈 [DB] category_scores no banco: ${JSON.stringify(updated.indice_biosync.category_scores)}`);
    } else {
      console.warn(`⚠️ [DB] indice_biosync retornado como null/undefined`);
    }
    
    return updated;

  } catch (error: any) {
    console.error(`❌ [DB] ERRO CRÍTICO em atualizarExameComBioSync:`, {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    throw error; // ✅ Propaga erro para o caller ver no log do Render
  }
}

/**
 * Busca exame por ID com todos os dados do BioSync
 */
export async function buscarExameComBioSync(exameId: string) {
  try {
    console.log(`🔍 [DB] Buscando exame: ${exameId}`);

    const res = await pool.query(
      `
      SELECT 
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
      FROM exames
      WHERE id = $1
      `,
      [exameId]
    );

    const exame = res.rows[0] ?? null;
    
    if (exame) {
      console.log(`✅ [DB] Exame encontrado: ${exame.id} | status: ${exame.status}`);
    } else {
      console.warn(`⚠️ [DB] Exame não encontrado: ${exameId}`);
    }

    return exame;

  } catch (error: any) {
    console.error('❌ [DB] ERRO em buscarExameComBioSync:', {
      message: error.message,
      code: error.code
    });
    throw error;
  }
}

// 🔧 Funções auxiliares internas
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