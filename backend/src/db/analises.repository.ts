import { pool } from "./client";

export async function salvarNovaAnalise(data: {
  // 🔥 DADOS BÁSICOS (nomes corretos da tabela analises)
  cliente_id: string;
  arquivo_url?: string;
  status?: string;
  tipo_cliente?: string;
  titulo_analise?: string;
  perfil_aplicado?: string;
  pdf_final_url?: string;
  html_relatorio?: string;
  
  // 🔥 DADOS PROCESSADOS
  dados_processados?: unknown;
  diagnostico?: unknown;
  comparacao?: unknown;
  interpretacao?: string;
  justificativa?: string;
  interpretacoes?: unknown;
  terapias_recomendadas?: unknown;
  
  // 🔥 LEGADO (mantido por segurança)
  protocolo?: unknown;
  
  // 🔥 NOVO MODELO BIOSYNC
  plano_terapeutico?: unknown;
  relatorio_original_html?: string;
  pontos_atencao?: unknown;
  pontos_criticos?: unknown;
  frequencia_lunara?: unknown;
  itens_alterados?: unknown;
  resumo_dashboard?: unknown;
  impacto_fitness?: unknown;
  
  // 🔥 NOVAS COLUNAS BIOSYNC (ESSENCIAIS!)
  modo_selecionado?: string;
  category_scores?: unknown;
  critical_alerts?: unknown;
  quick_wins?: unknown;
  imc_value?: number;
  imc_status?: string;
  suggested_protocol?: unknown;
  
  // 🔥 HASH E METADADOS
  pdf_hash: string;
}) {
  const res = await pool.query(
    `
    INSERT INTO analises (
      cliente_id,
      arquivo_url,
      status,
      tipo_cliente,
      titulo_analise,
      perfil_aplicado,
      pdf_final_url,
      html_relatorio,
      
      dados_processados,
      diagnostico,
      comparacao,
      interpretacao,
      justificativa,
      interpretacoes,
      terapias_recomendadas,
      
      protocolo,
      
      plano_terapeutico,
      relatorio_original_html,
      pontos_atencao,
      pontos_criticos,
      frequencia_lunara,
      itens_alterados,
      resumo_dashboard,
      impacto_fitness,
      
      -- 🔥 NOVAS COLUNAS BIOSYNC
      modo_selecionado,
      category_scores::jsonb,
      critical_alerts::jsonb,
      quick_wins::jsonb,
      imc_value,
      imc_status,
      suggested_protocol::jsonb,
      
      pdf_hash
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15,
      $16,
      $17, $18, $19, $20, $21, $22, $23, $24,
      -- 🔥 NOVOS VALORES BIOSYNC
      $25, $26::jsonb, $27::jsonb, $28::jsonb, $29, $30, $31::jsonb,
      $32
    )
    RETURNING *
    `,
    [
      // 🔥 DADOS BÁSICOS
      data.cliente_id,
      data.arquivo_url ?? null,
      data.status ?? 'processando',
      data.tipo_cliente ?? null,
      data.titulo_analise ?? 'Análise Bio-Holística',
      data.perfil_aplicado ?? null,
      data.pdf_final_url ?? null,
      data.html_relatorio ?? null,
      
      // 🔥 DADOS PROCESSADOS
      data.dados_processados ?? null,
      data.diagnostico ?? null,
      data.comparacao ?? null,
      data.interpretacao ?? null,
      data.justificativa ?? null,
      data.interpretacoes ?? null,
      data.terapias_recomendadas ?? null,
      
      // 🔥 LEGADO
      data.protocolo ?? null,
      
      // 🔥 NOVO MODELO
      data.plano_terapeutico ?? null,
      data.relatorio_original_html ?? null,
      data.pontos_atencao ?? null,
      data.pontos_criticos ?? null,
      data.frequencia_lunara ?? null,
      data.itens_alterados ?? null,
      data.resumo_dashboard ?? null,
      data.impacto_fitness ?? null,
      
      // 🔥 NOVOS VALORES BIOSYNC
      data.modo_selecionado ?? 'geral',
      data.category_scores ?? '{"fitness":0,"emocional":0,"sono":0,"imunidade":0,"mental":0}',
      data.critical_alerts ?? '[]',
      data.quick_wins ?? '[]',
      data.imc_value ?? null,
      data.imc_status ?? null,
      data.suggested_protocol ?? null,
      
      // 🔥 HASH
      data.pdf_hash,
    ]
  );

  return res.rows[0];
}

export async function buscarAnalisePorHashECliente(
  clientId: string,
  hash: string
) {
  const res = await pool.query(
    `
    SELECT *
    FROM analises
    WHERE cliente_id = $1
      AND pdf_hash = $2
    LIMIT 1
    `,
    [clientId, hash]
  );

  return res.rows[0] ?? null;
}

export async function buscarUltimaAnalisePorCliente(clientId: string) {
  const res = await pool.query(
    `
    SELECT *
    FROM analises
    WHERE cliente_id = $1
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [clientId]
  );

  return res.rows[0] ?? null;
}