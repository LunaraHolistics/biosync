import { Router } from "express";
import { parseBioressonancia } from "../utils/parserBio";
import { gerarDiagnostico } from "../services/diagnostico.service";
import { processBioSyncData } from "../services/engine-processor";
import { atualizarExameComBioSync } from '../db/exames.repository';

const router = Router();

/**
 * Converte dados do parser para formato da engine BioSync
 */
function converterParaEngineBioSync(dadosProcessados: any[]) {
  return dadosProcessados.map((item, index) => {
    let percentual = 50;

    if (item.valor !== undefined && item.valor !== null) {
      const valStr = String(item.valor).replace(',', '.');
      const valNum = parseFloat(valStr);

      if (!isNaN(valNum)) {
        if (valNum >= 1.0 && valNum <= 3.0) {
          percentual = 75 + ((valNum - 1.0) / 2.0) * 25;
        } else if (valNum > 0 && valNum < 1.0) {
          percentual = 20 + (valNum * 55);
        } else {
          percentual = Math.max(15, 100 - (Math.log10(valNum + 1) * 20));
        }
      } else if (valStr.includes('%')) {
        percentual = parseFloat(valStr) || 50;
      } else {
        percentual = 35;
      }
    }

    if (index < 3) {
      console.log(`🔄 Normalizado: "${item.item}" | Valor: "${item.valor}" → ${Math.round(percentual)}%`);
    }

    return {
      nome: item.item,
      percentual: Math.min(100, Math.max(0, Math.round(percentual))),
      categoria: item.categoria || item.sistema || 'Geral',
      status: item.status
    };
  });
}

router.post("/api/analyze", async (req, res) => {
  try {
    const {
      prompt,
      modo_analise = 'emotional_sleep',
      peso_cliente,
      altura_cliente_metros,
      exame_id
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt vazio" });
    }

    console.log("📥 Iniciando processamento...");
    console.log("📦 Modo:", modo_analise);

    /**
     * 1. Parse do HTML
     */
    const dadosProcessados = parseBioressonancia(prompt);
    console.log("✅ Itens processados:", dadosProcessados.length);

    if (!Array.isArray(dadosProcessados) || dadosProcessados.length === 0) {
      console.error("❌ Parser não extraiu dados válidos");
      return res.status(400).json({
        error: "Falha ao processar dados de bioressonância",
        hint: "Verifique se o HTML contém tabelas com itens de teste"
      });
    }

    // Debug: mostrar primeiros itens
    console.log("🔍 Primeiros itens extraídos:");
    dadosProcessados.slice(0, 3).forEach((item, i) => {
      console.log(`  ${i+1}. ${item.item} = ${item.valor} (${item.status})`);
    });

    /**
     * 2. Diagnóstico (LEGACY)
     */
    const diagnostico = gerarDiagnostico(dadosProcessados);

    /**
     * 3. Processamento BioSync Engine
     */
    console.log("\n🚀 Iniciando BioSync Engine...");
    
    const rawItems = converterParaEngineBioSync(dadosProcessados);
    
    console.log("📋 Itens para engine:", rawItems.length);
    console.log("📊 Amostra:", rawItems.slice(0, 3));

    let biosyncResult;
    try {
      biosyncResult = await processBioSyncData(
        rawItems,
        modo_analise,
        peso_cliente,
        altura_cliente_metros
      );

      console.log("✅ BioSync processado com sucesso!");
      console.log("📊 Scores:", biosyncResult.category_scores);
      console.log("🚨 Críticos:", biosyncResult.critical_alerts.length);

    } catch (engineError: any) {
      console.error("❌ ERRO NA ENGINE:", engineError.message);
      console.error("Stack:", engineError.stack);
      
      // Fallback para não quebrar o fluxo
      biosyncResult = {
        modo_selecionado: modo_analise,
        category_scores: { fitness: 0, emocional: 0, sono: 0, imunidade: 0, mental: 0 },
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
        nome: `Harmonização de ${p.sistema}`,
        descricao: `Atuação em ${p.item}`,
        frequencia: "1x por semana"
      }))
    };

    /**
     * 5. Resposta
     */
    const resposta = {
      interpretacao: "Análise baseada em bioressonância",
      pontos_criticos: diagnostico.problemas.filter((p: any) => p.prioridade === "alta").map((p: any) => p.item),
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
        console.log("\n💾 Salvando no banco...", exame_id);
        
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
        console.error("❌ ERRO AO SALVAR:", saveError.message);
        // Não bloqueia a resposta
      }
    } else {
      console.warn("⚠️ exame_id não informado - dados não salvos");
    }

    return res.json({
      success: true,
      data: resposta,
      total_items: dadosProcessados.length,
      biosync_scores: biosyncResult.category_scores
    });

  } catch (error: any) {
    console.error("❌ ERRO GERAL:", error);
    return res.status(500).json({
      error: "Erro ao processar análise",
      details: error.message
    });
  }
});

export default router;