import { Router, Request, Response } from "express";
import { parseBioressonancia } from "../utils/parserBio";
import { gerarDiagnostico } from "../services/diagnostico.service";
import { processBioSyncData } from "../services/engine-processor";
import { atualizarExameComBioSync, buscarExameComBioSync } from "../db/exames.repository";
import type { ItemProcessado } from "../utils/parserBio";
import type { ItemScoreEvolucao } from "../db/exames.repository";

const router = Router();

// ============================================================================
// 🧹 UTILITÁRIOS DE LIMPEZA E NORMALIZAÇÃO
// ============================================================================

function extrairNomeLimpo(texto: string | undefined): string {
  if (!texto) return 'Desconhecido';
  let limpo = texto.replace(/<[^>]*>/g, ' ').trim();
  
  if (limpo.includes('<') || limpo.includes('TABLE') || limpo.includes('body') || limpo.length > 100) {
    const match = limpo.match(/^([A-Za-zÀ-ÿ\s]+?)(?:\s*[\d\-\(\:]|$)/);
    if (match?.[1]?.trim() && match[1].trim().length <= 30) {
      return match[1].trim();
    }
    const palavras = limpo.split(/\s+/).filter(p =>
      p.length > 2 && p.length < 30 &&
      !p.match(/^(style|background|align|border|class|td|tr|font|color|table|body|html)$/i)
    );
    return palavras.slice(0, 2).join(' ') || 'Desconhecido';
  }
  return limpo || 'Desconhecido';
}

// 🔥 MAPEAMENTO DE CATEGORIAS PARA GARANTIR MATCH COM PESOS EMOCIONAIS
function normalizarCategoria(sistema?: string, categoria?: string): string {
  const texto = `${sistema || ''} ${categoria || ''}`.toLowerCase().trim();
  
  // Categorias emocionais/psicológicas
  if (
    texto.includes('consciencia') || 
    texto.includes('consciência') || 
    texto.includes('emocional') ||
    texto.includes('emotional') ||
    texto.includes('nivel de consciencia') ||
    texto.includes('nível de consciência') ||
    texto.includes('amor') || texto.includes('alegria') || texto.includes('paz') ||
    texto.includes('vergonha') || texto.includes('culpa') || texto.includes('medo') ||
    texto.includes('tristeza') || texto.includes('ansiedade') || texto.includes('depressao')
  ) {
    return 'emotional';
  }
  
  // Categorias de sono
  if (
    texto.includes('sono') || texto.includes('insomnia') || texto.includes('insonia') ||
    texto.includes('dormir') || texto.includes('descanso') || texto.includes('melatonina')
  ) {
    return 'sono';
  }
  
  // Categorias de imunidade
  if (
    texto.includes('imun') || texto.includes('defesa') || texto.includes('alergia') ||
    texto.includes('inflam') || texto.includes('infecc') || texto.includes('virus') ||
    texto.includes('bacteria') || texto.includes('linfonodo') || texto.includes('timo')
  ) {
    return 'imunidade';
  }
  
  // Categorias de fitness/físico
  if (
    texto.includes('fisico') || texto.includes('fitness') || texto.includes('musculo') ||
    texto.includes('forca') || texto.includes('energia') || texto.includes('metabolismo') ||
    texto.includes('peso') || texto.includes('gordura') || texto.includes('colesterol') ||
    texto.includes('circulacao') || texto.includes('coracao') || texto.includes('vascular')
  ) {
    return 'fitness';
  }
  
  // Categorias mental/cognitivo
  if (
    texto.includes('mental') || texto.includes('cognitivo') || texto.includes('memoria') ||
    texto.includes('concentracao') || texto.includes('foco') || texto.includes('nevoa') ||
    texto.includes('brain fog') || texto.includes('cerebro') || texto.includes('nervoso')
  ) {
    return 'mental';
  }
  
  // Fallback: usar categoria original ou 'Outros'
  return categoria || sistema || 'Outros';
}

function converterParaEngineBioSync(dadosProcessados: ItemProcessado[]) {
  return dadosProcessados.map((item, index: number) => {
    let percentual = 50;

    if (item.valor !== undefined && item.valor !== null) {
      const valStr = String(item.valor).replace(',', '.');
      const valNum = parseFloat(valStr);

      if (!isNaN(valNum)) {
        if (valNum >= 1.0 && valNum <= 3.0) {
          percentual = 75 + ((valNum - 1.0) / 2.0) * 25;
        } else if (valNum > 0 && valNum < 1.0) {
          percentual = 20 + (valNum * 55);
        } else if (valNum > 3.0) {
          percentual = Math.max(15, 100 - (Math.log10(valNum - 2) * 25));
        } else {
          percentual = 35;
        }
      } else if (valStr.includes('%')) {
        percentual = parseFloat(valStr) || 50;
      } else {
        percentual = 35;
      }
    }

    const nomeLimpo = extrairNomeLimpo(item.item);
    
    // 🔥 Normalizar categoria com mapeamento robusto
    const categoria = normalizarCategoria(item.sistema, (item as any).categoria);

    if (index < 5) {
      console.log(`🔄 [CONVERT] "${item.item?.substring(0, 30)}..." → "${nomeLimpo}" [${categoria}] = ${Math.round(percentual)}%`);
    }

    return {
      nome: nomeLimpo,
      percentual: Math.min(100, Math.max(0, Math.round(percentual))),
      categoria,
      status: item.status,
      valor_original: item.valor,
      // ✅ Campos obrigatórios para RawDeviceItem (usado pela engine)
      min: item.min ?? 0,
      max: item.max ?? 100,
      // 🔥 Manter referência original para debug
      _original: { sistema: item.sistema, item: item.item }
    };
  });
}

// ============================================================================
// 🔥 VALIDAÇÃO ROBUSTA DE PAYLOAD
// ============================================================================

function validarPayloadParaSupabase(payload: any): { valido: boolean; erros: string[] } {
  const erros: string[] = [];
  
  if (!payload.modo_selecionado) erros.push('modo_selecionado ausente');
  if (!payload.category_scores || typeof payload.category_scores !== 'object') erros.push('category_scores inválido');
  if (!Array.isArray(payload.critical_alerts)) erros.push('critical_alerts deve ser array');
  if (!Array.isArray(payload.quick_wins)) erros.push('quick_wins deve ser array');
  if (!Array.isArray(payload.translated_items)) erros.push('translated_items deve ser array');
  if (!Array.isArray(payload.matches)) erros.push('matches deve ser array');
  if (!Array.isArray(payload.item_scores)) erros.push('item_scores deve ser array');
  
  // Validar estrutura de item_scores
  if (Array.isArray(payload.item_scores)) {
    payload.item_scores.forEach((is: any, idx: number) => {
      if (!is.item) erros.push(`item_scores[${idx}]: item ausente`);
      if (!is.categoria) erros.push(`item_scores[${idx}]: categoria ausente`);
      if (typeof is.score_atual !== 'number' || isNaN(is.score_atual)) {
        erros.push(`item_scores[${idx}]: score_atual inválido (${is.score_atual})`);
      }
      if (!['melhorou', 'piorou', 'estavel', 'novo'].includes(is.trend)) {
        erros.push(`item_scores[${idx}]: trend inválido (${is.trend})`);
      }
    });
  }
  
  return { valido: erros.length === 0, erros };
}

// ============================================================================
// 🎯 ENDPOINT PRINCIPAL
// ============================================================================

router.post("/api/analyze", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    const {
      prompt,
      modo_analise = 'emotional_sleep',
      peso_cliente,
      altura_cliente_metros,
      exame_id
    } = req.body;

    console.log(`\n🆔 [${requestId}] === INÍCIO DA ANÁLISE ===`);
    console.log(`📥 [${new Date().toISOString()}] Iniciando análise...`);
    console.log(`📦 Modo: ${modo_analise} | exame_id: ${exame_id || 'N/A'}`);

    // -------------------------------------------------------------------------
    // 1️⃣ PARSE DO HTML
    // -------------------------------------------------------------------------
    console.log("\n🔍 [1/5] Executando parser HTML...");
    
    const dadosProcessados: ItemProcessado[] = parseBioressonancia(prompt);

    if (!Array.isArray(dadosProcessados) || dadosProcessados.length === 0) {
      console.error(`❌ [${requestId}] Parser não retornou dados válidos`);
      return res.status(400).json({
        error: "Falha ao processar dados de bioressonância",
        hint: "Verifique se o HTML contém tabelas com <tr><td>Item de Teste</td>...",
        requestId
      });
    }
    console.log(`✅ [${requestId}] Parser: ${dadosProcessados.length} itens extraídos`);

    // 🔥 Debug detalhado dos primeiros itens
    console.log(`🔍 [${requestId}] Primeiros 5 itens do parser:`);
    dadosProcessados.slice(0, 5).forEach((item, i: number) => {
      console.log(`   [${i + 1}] item="${item.item?.substring(0, 40)}" | sistema="${item.sistema}" | valor=${item.valor} | status=${item.status}`);
    });

    // -------------------------------------------------------------------------
    // 2️⃣ CONVERSÃO PARA ENGINE + LIMPEZA
    // -------------------------------------------------------------------------
    console.log("\n🔄 [2/5] Convertendo e limpando dados...");
    
    const itemsConvertidos = converterParaEngineBioSync(dadosProcessados);

    const itensValidos = itemsConvertidos.filter((i: any) =>
      i.nome && i.nome !== 'Desconhecido' && i.nome.length < 50 && !i.nome.includes('<')
    );

    console.log(`📋 [${requestId}] Itens válidos para engine: ${itensValidos.length} / ${itemsConvertidos.length}`);

    if (itensValidos.length === 0) {
      console.warn(`⚠️ [${requestId}] NENHUM ITEM VÁLIDO após filtragem!`);
      itemsConvertidos.slice(0, 5).forEach((i: any, idx: number) => {
        console.log(`   [${idx + 1}] nome="${i.nome}" | categoria="${i.categoria}" | length=${i.nome?.length} | tem '<': ${i.nome?.includes('<')}`);
      });
    }

    // 🔥 Log de amostra com categorias
    console.log(`📊 [${requestId}] Amostra de itens convertidos:`);
    itensValidos.slice(0, 5).forEach((i: any, idx: number) => {
      console.log(`   [${idx + 1}] ${i.nome}[${i.categoria}]:${i.percentual}%`);
    });

    // -------------------------------------------------------------------------
    // 3️⃣ PROCESSAMENTO DA ENGINE BIOSYNC
    // -------------------------------------------------------------------------
    console.log("\n🚀 [3/5] Executando BioSync Engine...");

    let biosyncResult: any;
    try {
      biosyncResult = await processBioSyncData(
        itensValidos,
        modo_analise as any,
        peso_cliente,
        altura_cliente_metros
      );

      console.log(`✅ [${requestId}] Engine: processamento concluído`);
      console.log(`📊 [${requestId}] Scores por categoria: ${JSON.stringify(biosyncResult.category_scores)}`);
      console.log(`🚨 [${requestId}] Alerts críticos: ${biosyncResult.critical_alerts?.length || 0}`);
      
      // 🔥 DEBUG DETALHADO DE MATCHES
      if (biosyncResult.matches?.length) {
        console.log(`📈 [${requestId}] Engine retornou ${biosyncResult.matches.length} matches`);
        
        // Contar matches por categoria
        const contagemPorCategoria: Record<string, number> = {};
        biosyncResult.matches.forEach((m: any) => {
          const cat = m.categoria || 'Outros';
          contagemPorCategoria[cat] = (contagemPorCategoria[cat] || 0) + 1;
        });
        console.log(`📈 [${requestId}] Matches por categoria:`, JSON.stringify(contagemPorCategoria));
        
        // Verificar scores calculados
        const matchesComScore = biosyncResult.matches.filter((m: any) => typeof m.score === 'number' && !isNaN(m.score));
        console.log(`📈 [${requestId}] Matches com score válido: ${matchesComScore.length}/${biosyncResult.matches.length}`);
        
        // 🔥 Log de amostra de matches COM scores
        console.log(`📈 [${requestId}] Amostra de matches (com scores):`);
        biosyncResult.matches.slice(0, 5).forEach((m: any, idx: number) => {
          console.log(`   [${idx + 1}] "${m.itemBase}" [${m.categoria}] score=${m.score} gravidade=${m.gravidade}`);
        });
        
        // 🔥 Verificar itens emocionais específicos
        const emocionais = biosyncResult.matches.filter((m: any) => 
          m.categoria?.toLowerCase() === 'emotional' || 
          ['amor', 'alegria', 'paz', 'vergonha', 'culpa', 'medo'].some(p => m.itemBase?.toLowerCase().includes(p))
        );
        if (emocionais.length > 0) {
          console.log(`📈 [${requestId}] Itens emocionais encontrados: ${emocionais.length}`);
          emocionais.slice(0, 3).forEach((m: any) => {
            console.log(`   • "${m.itemBase}" score=${m.score}`);
          });
        }
      } else {
        console.warn(`⚠️ [${requestId}] Engine NÃO retornou matches! matches=`, biosyncResult.matches);
      }

    } catch (engineError: any) {
      console.error(`❌ [${requestId}] ERRO NA ENGINE:`, {
        message: engineError.message,
        stack: process.env.NODE_ENV === 'development' ? engineError.stack : undefined
      });
      
      // Fallback seguro
      biosyncResult = {
        modo_selecionado: modo_analise,
        category_scores: { fitness: 50, emotional: 50, sono: 50, imunidade: 50, mental: 50 },
        critical_alerts: [],
        quick_wins: [],
        imc_value: null,
        imc_status: null,
        translated_items: [],
        suggested_protocol: { therapies: [], checklist: [], timeline: '' },
        matches: []
      };
    }

    // -------------------------------------------------------------------------
    // 4️⃣ DIAGNÓSTICO LEGACY + PLANO TERAPÊUTICO
    // -------------------------------------------------------------------------
    console.log("\n🩺 [4/5] Gerando diagnóstico e plano...");
    
    const diagnostico = gerarDiagnostico(dadosProcessados);
    
    const plano_terapeutico = {
      tipo: "semanal",
      terapias: diagnostico.problemas.slice(0, 5).map((p: any) => ({
        nome: `Harmonização de ${extrairNomeLimpo((p as any).sistema || p.item)}`,
        descricao: `Atuação em ${extrairNomeLimpo(p.item)}`,
        frequencia: "1x por semana",
        justificativa: (p as any).impacto || 'Desequilíbrio identificado'
      }))
    };

    console.log(`✅ [${requestId}] Diagnóstico: ${diagnostico.problemas.length} problemas | ${plano_terapeutico.terapias.length} terapias`);

    // -------------------------------------------------------------------------
    // 🔥 MAPEAR MATCHES PARA ITEM_SCORES (ESTRUTURA ESPERADA PELO FRONTEND)
    // -------------------------------------------------------------------------
    const itemScores: ItemScoreEvolucao[] = (biosyncResult.matches || []).map((m: any) => {
      // 🔥 Garantir que score seja número válido com fallback emocional
      let scoreCalculado = 50;
      if (typeof m.score === 'number' && !isNaN(m.score)) {
        scoreCalculado = m.score;
      } else {
        // Fallback: tentar calcular baseado na categoria e nome do item
        const itemNorm = (m.itemBase || '').toLowerCase().trim();
        const catNorm = (m.categoria || '').toLowerCase();
        
        // Pesos emocionais padrão
        const pesosEmocionais: Record<string, number> = {
          'amor': 75, 'alegria': 70, 'paz': 65, 'iluminismo': 50,
          'vergonha': 30, 'culpa': 25, 'apatia': 20, 'medo': 35,
          'tristeza': 35, 'ansiedade': 30, 'depressao': 25, 'estresse': 35
        };
        
        if (catNorm === 'emotional' || catNorm === 'emocional') {
          for (const [key, peso] of Object.entries(pesosEmocionais)) {
            if (itemNorm.includes(key)) {
              scoreCalculado = peso;
              break;
            }
          }
        }
      }
      
      return {
        item: m.itemBase || m.itemExame || 'Item desconhecido',
        categoria: m.categoria || 'Outros',
        score_atual: scoreCalculado,
        score_anterior: null,
        delta: 0,
        trend: 'novo' as const,
        impacto: m.impacto || m.descricaoTecnica || '',
        impacto_fitness: m.impacto_fitness
      };
    });

    console.log(`📊 [${requestId}] item_scores gerados: ${itemScores.length} itens`);
    if (itemScores.length > 0) {
      // 🔥 Log detalhado de amostra
      console.log(`📊 [${requestId}] Amostra de item_scores:`);
      itemScores.slice(0, 5).forEach((is: ItemScoreEvolucao, idx: number) => {
        console.log(`   [${idx + 1}] "${is.item}" [${is.categoria}] score=${is.score_atual} trend=${is.trend}`);
      });
      
      // 🔥 Estatísticas de scores
      const scores = itemScores.map(is => is.score_atual);
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      const unicos = [...new Set(scores)].sort((a, b) => a - b);
      
      console.log(`📊 [${requestId}] Estatísticas de scores: min=${min}, max=${max}, avg=${avg}, únicos=[${unicos.join(', ')}]`);
      
      // 🔥 Verificar se há scores variados (não todos 50)
      const todosCinquenta = scores.every(s => s === 50);
      if (todosCinquenta) {
        console.warn(`⚠️ [${requestId}] TODOS os scores são 50! Verificar lógica de cálculo.`);
      } else {
        console.log(`✅ [${requestId}] Scores variados detectados - OK`);
      }
    }

    // -------------------------------------------------------------------------
    // 5️⃣ MONTAGEM DA RESPOSTA
    // -------------------------------------------------------------------------
    console.log("\n📤 [5/5] Montando resposta...");
    
    const resposta = {
      interpretacao: "Análise baseada em bioressonância com identificação de desequilíbrios",
      pontos_criticos: diagnostico.problemas
        .filter((p: any) => (p as any).prioridade === "alta")
        .map((p: any) => extrairNomeLimpo(p.item)),
      plano_terapeutico,
      modo_selecionado: biosyncResult.modo_selecionado,
      category_scores: biosyncResult.category_scores,
      critical_alerts: biosyncResult.critical_alerts,
      quick_wins: biosyncResult.quick_wins,
      imc_value: biosyncResult.imc_value,
      imc_status: biosyncResult.imc_status,
      suggested_protocol: biosyncResult.suggested_protocol,
    };

    // -------------------------------------------------------------------------
    // 💾 SALVAMENTO NO SUPABASE (COM VALIDAÇÃO E CONFIRMAÇÃO)
    // -------------------------------------------------------------------------
    if (exame_id) {
      try {
        console.log(`\n💾 [${requestId}] Salvando no Supabase: ${exame_id}`);
        
        // Montar payload completo
        const payloadParaSalvar = {
          modo_selecionado: biosyncResult.modo_selecionado,
          category_scores: biosyncResult.category_scores,
          critical_alerts: biosyncResult.critical_alerts,
          quick_wins: biosyncResult.quick_wins,
          imc_value: biosyncResult.imc_value,
          imc_status: biosyncResult.imc_status,
          suggested_protocol: biosyncResult.suggested_protocol,
          translated_items: biosyncResult.translated_items || [],
          matches: biosyncResult.matches || [],
          item_scores: itemScores
        };
        
        // 🔥 Validar payload antes de enviar
        const { valido, erros } = validarPayloadParaSupabase(payloadParaSalvar);
        if (!valido) {
          console.error(`❌ [${requestId}] Payload inválido para Supabase:`, erros);
          // Continuar mesmo assim, mas logar o erro
        }
        
        console.log(`🔍 [${requestId}] Payload para salvar:`, {
          scores: Object.keys(biosyncResult.category_scores || {}).length,
          alerts: biosyncResult.critical_alerts?.length || 0,
          matches: biosyncResult.matches?.length || 0,
          item_scores: itemScores.length
        });

        // 🔥 Executar salvamento
        const resultadoSalvamento = await atualizarExameComBioSync(exame_id, payloadParaSalvar);
        
        console.log(`✅ [${requestId}] Supabase: exame atualizado com sucesso`);
        console.log(`📊 [${requestId}] Dados salvos: status=${resultadoSalvamento?.status}, updated_at=${resultadoSalvamento?.updated_at}`);
        
        // 🔥 CONFIRMAÇÃO: Re-consultar o exame para verificar se item_scores foi salvo
        try {
          const exameConfirmado = await buscarExameComBioSync(exame_id);
          const itemScoresSalvos = exameConfirmado?.indice_biosync?.item_scores;
          
          if (Array.isArray(itemScoresSalvos) && itemScoresSalvos.length > 0) {
            console.log(`✅ [${requestId}] CONFIRMAÇÃO: item_scores salvos no banco: ${itemScoresSalvos.length} itens`);
            // Log de amostra confirmada
            itemScoresSalvos.slice(0, 3).forEach((is: any, idx: number) => {
              console.log(`   [${idx + 1}] "${is.item}" [${is.categoria}] score=${is.score_atual}`);
            });
          } else {
            console.warn(`⚠️ [${requestId}] CONFIRMAÇÃO: item_scores NÃO encontrado no banco após salvamento!`);
            console.log(`🔍 [${requestId}] indice_biosync keys:`, Object.keys(exameConfirmado?.indice_biosync || {}));
          }
        } catch (confirmError: any) {
          console.warn(`⚠️ [${requestId}] Falha ao confirmar salvamento:`, confirmError.message);
        }

      } catch (saveError: any) {
        console.error(`❌ [${requestId}] ERRO AO SALVAR NO SUPABASE:`, {
          message: saveError.message,
          code: saveError.code,
          detail: saveError.detail,
          hint: saveError.hint
        });
        // Não falhar a requisição inteira, apenas logar o erro
      }
    } else {
      console.warn(`⚠️ [${requestId}] exame_id não informado - salvamento pulado`);
    }

    // -------------------------------------------------------------------------
    // 🎉 RESPOSTA FINAL
    // -------------------------------------------------------------------------
    const duration = Date.now() - startTime;
    console.log(`\n✅ [${requestId}] Análise concluída em ${duration}ms`);

    return res.json({
      success: true,
      data: resposta,
      meta: {
        total_items: dadosProcessados.length,
        valid_items: itensValidos.length,
        processing_time_ms: duration,
        modo: modo_analise,
        request_id: requestId
      },
      debug: {
        parser_ok: dadosProcessados.length > 0,
        engine_ok: !!biosyncResult?.category_scores,
        saved: !!exame_id,
        matches_count: biosyncResult.matches?.length || 0,
        item_scores_count: itemScores.length,
        scores_varied: itemScores.some((is: ItemScoreEvolucao) => is.score_atual !== 50),
        html_fallback_used: dadosProcessados.some((d: any) => d.item?.includes('<TABLE')),
      }
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`❌ [${requestId}] ERRO GERAL em /api/analyze (${duration}ms):`, {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    return res.status(500).json({
      error: "Erro interno ao processar análise",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString(),
      request_id: requestId
    });
  }
});

export default router;