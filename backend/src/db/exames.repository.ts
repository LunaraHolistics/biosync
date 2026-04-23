import { pool } from "./client";

/**
 * Atualiza um exame existente com os resultados da engine BioSync
 */
export async function atualizarExameComBioSync(exameId: string, biosyncResult: {
  modo_selecionado: string;
  category_scores: Record<string, number>;
  critical_alerts: Array<{ item: string; score: number; impact: string }>;
  quick_wins: Array<{ item: string; action: string; expected: string }>;
  imc_value: number | null;
  imc_status: string | null;
  suggested_protocol: { therapies: string[]; checklist: string[]; timeline: string };
  translated_items?: Array<{ raw: string; client_term: string; trainer_term: string }>;
}) {
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
    RETURNING *
    `,
    [
      // analise_ia: Resumo executivo para o frontend
      JSON.stringify({
        score_geral: calculateOverallScore(biosyncResult.category_scores),
        resumo: generateSummary(biosyncResult),
        modo: biosyncResult.modo_selecionado,
        critical_count: biosyncResult.critical_alerts.length,
        quick_wins_count: biosyncResult.quick_wins.length
      }),
      
      // indice_biosync: Dados completos da engine
      JSON.stringify({
        category_scores: biosyncResult.category_scores,
        critical_alerts: biosyncResult.critical_alerts,
        quick_wins: biosyncResult.quick_wins,
        imc: { value: biosyncResult.imc_value, status: biosyncResult.imc_status },
        protocol: biosyncResult.suggested_protocol,
        translated_items: biosyncResult.translated_items || []
      }),
      
      // pontos_criticos: Array simples de strings para listagem rápida
      biosyncResult.critical_alerts.map(c => c.item),
      
      // plano_terapeutico: Protocolo sugerido
      JSON.stringify(biosyncResult.suggested_protocol),
      
      // ID do exame a atualizar
      exameId
    ]
  );

  return res.rows[0];
}

/**
 * Busca exame por ID com todos os dados do BioSync
 */
export async function buscarExameComBioSync(exameId: string) {
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

  return res.rows[0] ?? null;
}

// 🔧 Funções auxiliares internas
function calculateOverallScore(scores: Record<string, number>): number {
  const values = Object.values(scores).filter(v => v > 0);
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function generateSummary(result: any): string {
  const lowScores = Object.entries(result.category_scores)
    .filter(([_, v]: [string, any]) => v < 50)
    .map(([k, _]: [string, any]) => k);
  
  if (lowScores.length === 0) return "Perfil bioenergético equilibrado.";
  return `Atenção em: ${lowScores.join(', ')}. ${result.critical_alerts[0]?.impact || ''}`;
}