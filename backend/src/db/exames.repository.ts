// backend/src/db/exames.repository.ts
import { pool } from "./client";

/**
 * Atualiza um exame existente com os resultados da engine BioSync
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
    console.log(`🔄 [DB] Iniciando atualização do exame: ${exameId}`);

    // ✅ Validação inicial
    if (!exameId) {
      console.error('❌ [DB] exameId não informado');
      throw new Error('exameId é obrigatório');
    }

    // ✅ Preparar payloads
    const analiseIaPayload = {
      score_geral: calculateOverallScore(biosyncResult.category_scores),
      resumo: generateSummary(biosyncResult),
      modo: biosyncResult.modo_selecionado,
      critical_count: biosyncResult.critical_alerts.length,
      quick_wins_count: biosyncResult.quick_wins.length
    };

    const indiceBiosyncPayload = {
      category_scores: biosyncResult.category_scores,
      critical_alerts: biosyncResult.critical_alerts,
      quick_wins: biosyncResult.quick_wins,
      imc: { value: biosyncResult.imc_value, status: biosyncResult.imc_status },
      protocol: biosyncResult.suggested_protocol,
      translated_items: biosyncResult.translated_items || [],
      processed_at: new Date().toISOString()
    };

    const pontosCriticosPayload = biosyncResult.critical_alerts.map(c => c.item);
    const planoTerapeuticoPayload = biosyncResult.suggested_protocol;

    console.log(`📦 [DB] Payloads preparados - scores: ${Object.keys(biosyncResult.category_scores).length} categorias`);

    // ✅ Executar query de atualização
    const res = await pool.query(
      `
      UPDATE exames
      SET 
        analise_ia = $1::jsonb,
        indice_biosync = $2::jsonb,
        pontos_criticos = $3,
        plano_terapeutico = $4::jsonb,
        status = 'concluido',
        updated_at = now()
      WHERE id = $5
      RETURNING id, status, updated_at
      `,
      [
        JSON.stringify(analiseIaPayload),
        JSON.stringify(indiceBiosyncPayload),
        pontosCriticosPayload,
        JSON.stringify(planoTerapeuticoPayload),
        exameId
      ]
    );

    // ✅ Validar resultado
    if (!res.rows || res.rows.length === 0) {
      console.error(`❌ [DB] Nenhum registro atualizado para exameId: ${exameId}`);
      throw new Error(`Exame não encontrado ou não atualizado: ${exameId}`);
    }

    const updated = res.rows[0];
    console.log(`✅ [DB] Exame atualizado com sucesso: ${updated.id} | status: ${updated.status} | updated_at: ${updated.updated_at}`);

    return updated;

  } catch (error: any) {
    console.error('❌ [DB] ERRO em atualizarExameComBioSync:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      hint: error.hint,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    throw error; // ✅ Propaga para o caller saber que falhou
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