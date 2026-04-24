// backend/src/db/exames.repository.ts
import { pool } from '../config/pool'; // ✅ Import do pool, não do supabase client

/**
 * Atualiza um exame existente com os resultados da engine BioSync
 */
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
    console.log(`🔄 [DB] INICIANDO UPDATE - exameId: ${exameId}`);
    
    // ✅ Validar entrada
    if (!exameId) {
      console.error('❌ [DB] exameId é obrigatório');
      throw new Error('exameId não fornecido');
    }

    // ✅ Preparar payloads
    const indiceBiosyncPayload = {
      category_scores: biosyncResult.category_scores,
      critical_alerts: biosyncResult.critical_alerts,
      quick_wins: biosyncResult.quick_wins,
      imc: { value: biosyncResult.imc_value, status: biosyncResult.imc_status },
      protocol: biosyncResult.suggested_protocol,
      translated_items: biosyncResult.translated_items || [],
      processed_at: new Date().toISOString()
    };

    console.log(`📦 [DB] Payload preparado - scores: ${JSON.stringify(biosyncResult.category_scores)}`);

    // ✅ Executar UPDATE
    const res = await pool.query(
      `
      UPDATE exames
      SET 
        status = 'concluido',
        indice_biosync = $1::jsonb,
        updated_at = now()
      WHERE id = $2
      RETURNING id, status, updated_at, indice_biosync
      `,
      [
        JSON.stringify(indiceBiosyncPayload),
        exameId
      ]
    );

    console.log(`📊 [DB] Query executada - rows affected: ${res.rowCount}`);

    // ✅ Validar resultado
    if (!res.rows || res.rows.length === 0) {
      // 🔍 Verificar se o exame existe
      const check = await pool.query('SELECT id, status FROM exames WHERE id = $1', [exameId]);
      if (check.rows.length === 0) {
        console.error(`❌ [DB] Exame NÃO ENCONTRADO: ${exameId}`);
        throw new Error(`Exame não existe: ${exameId}`);
      } else {
        console.error(`❌ [DB] UPDATE não retornou linhas. Exame existe: ${check.rows[0].status}`);
        throw new Error('UPDATE não afetou nenhuma linha - possível problema de permissão ou trigger');
      }
    }

    const updated = res.rows[0];
    console.log(`✅ [DB] Exame atualizado: ${updated.id} | status: ${updated.status} | updated_at: ${updated.updated_at}`);
    
    return updated;

  } catch (error: any) {
    console.error('❌ [DB] ERRO CRÍTICO em atualizarExameComBioSync:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    throw error; // ✅ Propaga para o caller
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