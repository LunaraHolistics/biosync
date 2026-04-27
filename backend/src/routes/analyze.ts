import { Router, Request, Response } from "express";
import { parseBioressonancia } from "../utils/parserBio";
import { gerarDiagnostico } from "../services/diagnostico.service";
import { processBioSyncData } from "../services/engine-processor";
import { atualizarExameComBioSync } from "../db/exames.repository";
import type { ItemProcessado } from "../utils/parserBio";

const router = Router();

// ============================================================================
// 🧹 UTILITÁRIOS DE LIMPEZA
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

    if (index < 3) {
      console.log(`🔄 [CONVERT] "${item.item?.substring(0, 20)}..." → "${nomeLimpo}" = ${Math.round(percentual)}%`);
    }

    return {
      nome: nomeLimpo,
      percentual: Math.min(100, Math.max(0, Math.round(percentual))),
      categoria: (item as any).categoria || item.sistema || 'Geral',
      status: item.status,
      valor_original: item.valor,
      // ✅ Campos obrigatórios para RawDeviceItem (usado pela engine)
      min: item.min ?? 0,
      max: item.max ?? 100
    };
  });
}

// ============================================================================
// 🎯 ENDPOINT PRINCIPAL
// ============================================================================

router.post("/api/analyze", async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const {
      prompt,
      modo_analise = 'emotional_sleep',
      peso_cliente,
      altura_cliente_metros,
      exame_id
    } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 50) {
      return res.status(400).json({
        error: "Prompt inválido ou vazio",
        hint: "Envie o conteúdo HTML completo do relatório de bioressonância"
      });
    }

    console.log(`\n📥 [${new Date().toISOString()}] Iniciando análise...`);
    console.log(`📦 Modo: ${modo_analise} | exame_id: ${exame_id || 'N/A'}`);

    // -------------------------------------------------------------------------
    // 1️⃣ PARSE DO HTML
    // -------------------------------------------------------------------------
    console.log("\n🔍 [1/5] Executando parser HTML...");
    
    // ✅ parseBioressonancia agora retorna ItemProcessado[] diretamente
    const dadosProcessados: ItemProcessado[] = parseBioressonancia(prompt);

    if (!Array.isArray(dadosProcessados) || dadosProcessados.length === 0) {
      console.error("❌ Parser não retornou dados válidos");
      return res.status(400).json({
        error: "Falha ao processar dados de bioressonância",
        hint: "Verifique se o HTML contém tabelas com <tr><td>Item de Teste</td>..."
      });
    }
    console.log(`✅ Parser: ${dadosProcessados.length} itens extraídos`);

    console.log("🔍 [DEBUG] Primeiros itens do parser:");
    dadosProcessados.slice(0, 3).forEach((item, i: number) => {
      console.log(`   [${i + 1}] item="${item.item}" | valor=${item.valor} | status=${item.status}`);
    });

    // -------------------------------------------------------------------------
    // 2️⃣ CONVERSÃO PARA ENGINE + LIMPEZA
    // -------------------------------------------------------------------------
    console.log("\n🔄 [2/5] Convertendo e limpando dados...");
    
    // ✅ dadosProcessados já é ItemProcessado[] → compatível com converterParaEngineBioSync
    const itemsConvertidos = converterParaEngineBioSync(dadosProcessados);

    const itensValidos = itemsConvertidos.filter((i: any) =>
      i.nome && i.nome !== 'Desconhecido' && i.nome.length < 50 && !i.nome.includes('<')
    );

    console.log(`📋 Itens válidos para engine: ${itensValidos.length} / ${itemsConvertidos.length}`);

    if (itensValidos.length === 0) {
      console.warn("⚠️ Nenhum item válido após filtragem:");
      itemsConvertidos.slice(0, 5).forEach((i: any, idx: number) => {
        console.log(`   [${idx + 1}] nome="${i.nome}" | length=${i.nome?.length}`);
      });
    }

    console.log(`📊 Amostra: ${itensValidos.slice(0, 3).map((i: any) => `${i.nome}:${i.percentual}%`).join(', ')}`);

    // -------------------------------------------------------------------------
    // 3️⃣ PROCESSAMENTO DA ENGINE BIOSYNC
    // -------------------------------------------------------------------------
    console.log("\n🚀 [3/5] Executando BioSync Engine...");

    let biosyncResult: any;
    try {
      // ✅ itensValidos vem de converterParaEngineBioSync → já tem estrutura compatível
      biosyncResult = await processBioSyncData(
        itensValidos,
        modo_analise as any,
        peso_cliente,
        altura_cliente_metros
      );

      console.log("✅ Engine: processamento concluído");
      console.log(`📊 Scores: ${JSON.stringify(biosyncResult.category_scores)}`);
      console.log(`🚨 Alerts: ${biosyncResult.critical_alerts?.length || 0} críticos`);
      
      // 🔍 Debug: verificar se matches está presente
      if (biosyncResult.matches?.length) {
        console.log(`📈 [Engine] matches disponíveis para histórico: ${biosyncResult.matches.length} itens`);
      }

    } catch (engineError: any) {
      console.error("❌ ERRO NA ENGINE:", engineError.message);
      
      biosyncResult = {
        modo_selecionado: modo_analise,
        category_scores: { fitness: 50, emotional: 50, sono: 50, imunidade: 50, mental: 50 },
        critical_alerts: [],
        quick_wins: [],
        imc_value: null,
        imc_status: null,
        translated_items: [],
        suggested_protocol: { therapies: [], checklist: [], timeline: '' },
        matches: [] // ✅ Garantir matches vazio no fallback
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

    console.log(`✅ Diagnóstico: ${diagnostico.problemas.length} problemas | ${plano_terapeutico.terapias.length} terapias`);

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
    // 💾 SALVAMENTO NO SUPABASE (opcional)
    // -------------------------------------------------------------------------
    if (exame_id) {
      try {
        console.log(`\n💾 Salvando no Supabase: ${exame_id}`);
        
        console.log('🔍 [PAYLOAD] Dados para salvar:', {
          scores: biosyncResult.category_scores,
          alerts: biosyncResult.critical_alerts?.length,
          imc: biosyncResult.imc_value,
          matches_count: biosyncResult.matches?.length || 0
        });

        // 🔥 NOVO: Passar matches para salvar item_scores no histórico
        await atualizarExameComBioSync(exame_id, {
          modo_selecionado: biosyncResult.modo_selecionado,
          category_scores: biosyncResult.category_scores,
          critical_alerts: biosyncResult.critical_alerts,
          quick_wins: biosyncResult.quick_wins,
          imc_value: biosyncResult.imc_value,
          imc_status: biosyncResult.imc_status,
          suggested_protocol: biosyncResult.suggested_protocol,
          translated_items: biosyncResult.translated_items || [],
          // 🔥 NOVO: matches para histórico de evolução por item
          matches: biosyncResult.matches || []
        });

        console.log("✅ Supabase: exame atualizado com sucesso");

      } catch (saveError: any) {
        console.error("❌ ERRO AO SALVAR:", {
          message: saveError.message,
          code: saveError.code,
          detail: saveError.detail
        });
      }
    } else {
      console.warn("⚠️ exame_id não informado - salvamento pulado");
    }

    // -------------------------------------------------------------------------
    // 🎉 RESPOSTA FINAL
    // -------------------------------------------------------------------------
    const duration = Date.now() - startTime;
    console.log(`\n✅ Análise concluída em ${duration}ms`);

    return res.json({
      success: true,
      data: resposta,
      meta: {
        total_items: dadosProcessados.length,
        valid_items: itensValidos.length,
        processing_time_ms: duration,
        modo: modo_analise
      },
      debug: {
        parser_ok: dadosProcessados.length > 0,
        engine_ok: !!biosyncResult?.category_scores,
        saved: !!exame_id,
        html_fallback_used: dadosProcessados.some((d: any) => d.item?.includes('<TABLE')),
        matches_saved: !!(biosyncResult.matches?.length && exame_id)
      }
    });

  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`❌ ERRO GERAL em /api/analyze (${duration}ms):`, {
      name: error.name,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });

    return res.status(500).json({
      error: "Erro interno ao processar análise",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;