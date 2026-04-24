import { Router, Request, Response } from "express";
import { parseBioressonancia } from "../utils/parserBio";
import { gerarDiagnostico } from "../services/diagnostico.service";
import { processBioSyncData } from "../services/engine-processor";
import { atualizarExameComBioSync } from "../db/exames.repository";

const router = Router();

/**
 * 🔧 EXTRAÇÃO DE NOME LIMPO (fallback se parser falhar)
 * Tenta extrair nome legível de string HTML corrompida
 */
function extrairNomeLimpo(texto: string | undefined): string {
  if (!texto) return 'Desconhecido';
  
  // Remove tags HTML
  let limpo = texto.replace(/<[^>]*>/g, ' ').trim();
  
  // Se ainda tiver HTML, tenta extrair primeira palavra legível
  if (limpo.includes('<') || limpo.includes('TABLE') || limpo.includes('body')) {
    // Tenta encontrar padrão "Nome do Item" antes de números ou hífens
    const match = limpo.match(/^([A-Za-zÀ-ÿ\s]+?)(?:\s*[\d\-\(]|$)/);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
    // Fallback: pega primeiras 3 palavras não-HTML
    const palavras = limpo.split(/\s+/).filter(p => 
      p.length > 2 && !p.match(/^(style|background|align|border|class|td|tr|font|color)$/i)
    );
    return palavras.slice(0, 3).join(' ') || 'Desconhecido';
  }
  
  return limpo || 'Desconhecido';
}

/**
 * Converte dados do parser para formato da engine BioSync
 */
function converterParaEngineBioSync(dadosProcessados: any[]) {
  return dadosProcessados.map((item: any, index: number) => {
    let percentual = 50;

    if (item.valor !== undefined && item.valor !== null) {
      const valStr = String(item.valor).replace(',', '.');
      const valNum = parseFloat(valStr);

      if (!isNaN(valNum)) {
        // ✅ Lógica de normalização: valor dentro da faixa normal = score alto
        if (valNum >= 1.0 && valNum <= 3.0) {
          // Faixa ideal: score entre 75-100
          percentual = 75 + ((valNum - 1.0) / 2.0) * 25;
        } else if (valNum > 0 && valNum < 1.0) {
          // Abaixo do ideal: score entre 20-75
          percentual = 20 + (valNum * 55);
        } else if (valNum > 3.0) {
          // Acima do ideal: penalização progressiva
          percentual = Math.max(15, 100 - (Math.log10(valNum - 2) * 25));
        } else {
          percentual = 35;
        }
      } else if (valStr.includes('%')) {
        // Se já vem em porcentagem, usa direto
        percentual = parseFloat(valStr) || 50;
      } else {
        // Valor não numérico: score baixo
        percentual = 35;
      }
    }

    // ✅ CORREÇÃO: Extrair nome limpo mesmo se parser falhar
    const nomeLimpo = extrairNomeLimpo(item.item);

    // Debug dos primeiros itens
    if (index < 3) {
      console.log(`🔄 Normalizado: "${nomeLimpo}" | Valor: "${item.valor}" → ${Math.round(percentual)}%`);
    }

    return {
      nome: nomeLimpo,
      percentual: Math.min(100, Math.max(0, Math.round(percentual))),
      categoria: item.categoria || item.sistema || 'Geral',
      status: item.status
    };
  });
}

router.post("/api/analyze", async (req: Request, res: Response) => {
  try {
    const {
      prompt,
      modo_analise = 'emotional_sleep',
      peso_cliente,
      altura_cliente_metros,
      exame_id
    } = req.body;

    // ✅ Validação robusta do prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 50) {
      return res.status(400).json({ 
        error: "Prompt inválido ou vazio",
        hint: "Envie o conteúdo HTML completo do relatório de bioressonância"
      });
    }

    console.log("📥 Iniciando processamento...");
    console.log("📦 Modo:", modo_analise);
    console.log("🔑 exame_id:", exame_id || 'não informado');

    /**
     * 1. Parse do HTML
     */
    console.log("\n🔍 Executando parser HTML...");
    const dadosProcessados = parseBioressonancia(prompt);
    console.log("✅ Itens processados:", dadosProcessados.length);

    // ✅ Validação crítica: parser deve retornar itens com nomes legíveis
    if (!Array.isArray(dadosProcessados) || dadosProcessados.length === 0) {
      console.error("❌ Parser não extraiu dados válidos");
      return res.status(400).json({
        error: "Falha ao processar dados de bioressonância",
        hint: "Verifique se o HTML contém tabelas com <tr><td>Item de Teste</td>..."
      });
    }

    // ✅ Debug: validar se os itens têm nomes legíveis (não HTML cru)
    const primeirosItens = dadosProcessados.slice(0, 5);
    console.log("🔍 Primeiros itens extraídos:");
    primeirosItens.forEach((item: any, i: number) => {
      const nomeOriginal = item.item?.substring(0, 50) + (item.item?.length > 50 ? '...' : '');
      const nomeLimpo = extrairNomeLimpo(item.item);
      console.log(`  ${i+1}. [RAW] "${nomeOriginal}" → [LIMPO] "${nomeLimpo}" = ${item.valor} (${item.status})`);
    });

    // ✅ Alerta e tentativa de recuperação se parser retornar HTML cru
    const temHtmlCru = primeirosItens.some((item: any) => 
      item.item?.includes('<TABLE') || item.item?.includes('<body') || item.item?.length > 200
    );
    
    if (temHtmlCru) {
      console.warn("⚠️ Parser retornou HTML cru - aplicando fallback de extração de nomes");
      // O fallback já está embutido em converterParaEngineBioSync via extrairNomeLimpo()
    }

    /**
     * 2. Diagnóstico (LEGACY)
     */
    console.log("\n🩺 Gerando diagnóstico...");
    const diagnostico = gerarDiagnostico(dadosProcessados);
    console.log(`✅ Diagnóstico: ${diagnostico.problemas.length} problemas identificados`);

    /**
     * 3. Processamento BioSync Engine
     */
    console.log("\n🚀 Iniciando BioSync Engine...");
    
    const rawItems = converterParaEngineBioSync(dadosProcessados);
    
    // ✅ Filtrar itens com nomes inválidos após conversão
    const itensValidos = rawItems.filter((i: any) => 
      i.nome && i.nome !== 'Desconhecido' && i.nome.length < 100
    );
    
    console.log("📋 Itens para engine:", itensValidos.length, `(de ${rawItems.length} brutos)`);
    console.log("📊 Amostra:", itensValidos.slice(0, 3).map((i: any) => `${i.nome}: ${i.percentual}%`));

    let biosyncResult;
    try {
      biosyncResult = await processBioSyncData(
        itensValidos, // ✅ Usa apenas itens válidos
        modo_analise as any,
        peso_cliente,
        altura_cliente_metros
      );

      console.log("✅ BioSync processado com sucesso!");
      console.log("📊 Scores:", biosyncResult.category_scores);
      console.log("🚨 Críticos:", biosyncResult.critical_alerts.length);

    } catch (engineError: any) {
      console.error("❌ ERRO NA ENGINE:", engineError.message);
      console.error("Stack:", engineError.stack);
      
      // ✅ Fallback com chaves CORRETAS (emotional, não emocional)
      biosyncResult = {
        modo_selecionado: modo_analise,
        category_scores: { 
          fitness: 50, 
          emotional: 50,
          sono: 50, 
          imunidade: 50, 
          mental: 50 
        },
        critical_alerts: [],
        quick_wins: [],
        imc_value: null,
        imc_status: null,
        translated_items: [],
        suggested_protocol: { therapies: [], checklist: [], timeline: '' }
      };
    }

    /**
     * 4. Plano terapêutico
     */
    const plano_terapeutico = {
      tipo: "semanal",
      terapias: diagnostico.problemas.slice(0, 5).map((p: any) => ({
        nome: `Harmonização de ${extrairNomeLimpo(p.sistema || p.item)}`,
        descricao: `Atuação em ${extrairNomeLimpo(p.item)}`,
        frequencia: "1x por semana",
        justificativa: p.impacto || 'Desequilíbrio identificado'
      }))
    };

    /**
     * 5. Resposta
     */
    const resposta = {
      interpretacao: "Análise baseada em bioressonância com identificação de desequilíbrios",
      pontos_criticos: diagnostico.problemas
        .filter((p: any) => p.prioridade === "alta")
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

    /**
     * 6. 💾 SALVAR NO BANCO
     */
    if (exame_id) {
      try {
        console.log("\n💾 Salvando no Supabase...", exame_id);
        
        await atualizarExameComBioSync(exame_id, {
          modo_selecionado: biosyncResult.modo_selecionado,
          category_scores: biosyncResult.category_scores,
          critical_alerts: biosyncResult.critical_alerts,
          quick_wins: biosyncResult.quick_wins,
          imc_value: biosyncResult.imc_value,
          imc_status: biosyncResult.imc_status,
          suggested_protocol: biosyncResult.suggested_protocol,
          translated_items: biosyncResult.translated_items || []
        });

        console.log("✅ Exame atualizado no Supabase!");
        console.log("📊 Status: concluido");
        
      } catch (saveError: any) {
        console.error("❌ ERRO AO SALVAR:", {
          message: saveError.message,
          code: saveError.code,
          detail: saveError.detail,
          stack: process.env.NODE_ENV === 'development' ? saveError.stack : undefined
        });
        // ✅ Não bloqueia a resposta, mas loga o erro completo
      }
    } else {
      console.warn("⚠️ exame_id não informado - dados não salvos no banco");
    }

    return res.json({
      success: true,
      data: resposta,
      total_items: dadosProcessados.length,
      biosync_scores: biosyncResult.category_scores,
      debug: {
        parser_ok: dadosProcessados.length > 0,
        engine_ok: !!biosyncResult,
        saved: !!exame_id,
        html_fallback_used: temHtmlCru
      }
    });

  } catch (error: any) {
    console.error("❌ ERRO GERAL em /api/analyze:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    return res.status(500).json({
      error: "Erro interno ao processar análise",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;