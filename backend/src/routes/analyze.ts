import { Router } from "express";
import { parseBioressonancia } from "../utils/parserBio";
import { gerarDiagnostico } from "../services/diagnostico.service";
import { processBioSyncData } from "../services/engine-processor";
import { atualizarExameComBioSync } from '../db/exames.repository';

const router = Router();

/**
 * Junta múltiplos textos em um único dataset
 */
function parseMultiplos(textos: string[]) {
  const todos: ReturnType<typeof parseBioressonancia> = [];

  for (const texto of textos) {
    if (!texto || typeof texto !== "string") continue;

    const resultado = parseBioressonancia(texto);

    if (Array.isArray(resultado) && resultado.length > 0) {
      todos.push(...resultado);
    }
  }

  return todos;
}

/**
 * Comparação entre exames
 */
function compararExames(
  atual: ReturnType<typeof parseBioressonancia>,
  anterior: ReturnType<typeof parseBioressonancia> | null,
) {
  if (!anterior || !Array.isArray(anterior)) return null;

  const mapaAnterior = new Map(
    anterior.map((a) => [`${a.sistema}-${a.item}`, a]),
  );

  const comparacao = atual
    .map((item) => {
      const key = `${item.sistema}-${item.item}`;
      const prev = mapaAnterior.get(key);

      if (!prev) return null;

      let tendencia: "melhora" | "piora" | "estavel" = "estavel";

      if (item.valor < prev.valor) tendencia = "melhora";
      if (item.valor > prev.valor) tendencia = "piora";

      return {
        sistema: item.sistema,
        item: item.item,
        atual: item.valor,
        anterior: prev.valor,
        tendencia,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return comparacao;
}

/**
 * Converte dados do parser para formato da engine BioSync
 * 🔬 INCLUI NORMALIZAÇÃO DE VALORES BRUTOS PARA ESCALA 0-100
 */
function converterParaEngineBioSync(dadosProcessados: ReturnType<typeof parseBioressonancia>) {
  return dadosProcessados.map((item, index) => {
    let percentual = 50; // Valor neutro padrão

    if (item.valor !== undefined && item.valor !== null) {
      const valStr = String(item.valor).replace(',', '.');
      const valNum = parseFloat(valStr);

      if (!isNaN(valNum)) {
        // 📏 Heurística de normalização para índices de bioressonância
        // Faixa de referência típica para a maioria dos índices: 0.5 a 5.0
        if (valNum >= 1.0 && valNum <= 3.0) {
          percentual = 75 + ((valNum - 1.0) / 2.0) * 25; // 75-100 (Faixa ideal)
        } else if (valNum > 0 && valNum < 1.0) {
          percentual = 20 + (valNum * 55); // 20-75 (Abaixo do ideal)
        } else {
          percentual = Math.max(15, 100 - (Math.log10(valNum + 1) * 20)); // >3.0 (Acima do ideal)
        }
      } else {
        // Valores qualitativos ou percentuais diretos
        if (valStr.includes('%')) {
          percentual = parseFloat(valStr) || 50; // Extrai se vier como "33%"
        } else {
          percentual = 35; // Considera desequilíbrio moderado para textos qualitativos
        }
      }
    }

    // 🔍 Log apenas dos 3 primeiros itens para validação rápida
    if (index < 3) {
      console.log(`🔄 Normalizado: "${item.item}" | Valor bruto: "${item.valor}" → ${Math.round(percentual)}%`);
    }

    return {
      nome: item.item,
      percentual: Math.min(100, Math.max(0, Math.round(percentual))),
      categoria: item.categoria || 'Geral',
      status: item.status
    };
  });
}

/**
 * Geração simples de plano terapêutico (BASE)
 */
function gerarPlanoTerapeutico(
  diagnostico: ReturnType<typeof gerarDiagnostico>,
) {
  const terapias = diagnostico.problemas.slice(0, 5).map((p) => ({
    nome: `Harmonização de ${p.sistema}`,
    descricao: `Atuação energética focada em ${p.item}, visando equilíbrio e regulação do sistema.`,
    frequencia: "1x por semana",
    justificativa: `Identificado desequilíbrio em ${p.item}, com impacto em ${p.sistema}.`,
  }));

  return {
    tipo: "semanal",
    terapias,
  };
}

/**
 * Request tipado
 */
type AnalyzeRequest = {
  prompt: string | string[];
  anterior_dados_processados?: ReturnType<typeof parseBioressonancia>;
  modo_analise?: 'fitness' | 'weight_loss' | 'emotional_sleep' | 'immunity' | 'mental';
  peso_cliente?: number;
  altura_cliente_metros?: number;
  exame_id?: string; // ← Adicionado para tipar o campo de salvamento
};

router.post("/api/analyze", async (req, res) => {
  try {
    const {
      prompt,
      anterior_dados_processados,
      modo_analise = 'fitness',
      peso_cliente,
      altura_cliente_metros,
      exame_id
    } = req.body as AnalyzeRequest;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt vazio" });
    }

    console.log("Tipo do prompt:", typeof prompt);
    if (Array.isArray(prompt)) {
      console.log("Qtd arquivos recebidos:", prompt.length);
    }

    /**
     * 1. Parse
     */
    const dadosProcessados = Array.isArray(prompt)
      ? parseMultiplos(prompt)
      : parseBioressonancia(prompt);

    console.log("Itens processados:", dadosProcessados.length);

    if (!Array.isArray(dadosProcessados) || dadosProcessados.length === 0) {
      return res.status(400).json({
        error: "Falha ao processar dados de bioressonância",
      });
    }

    /**
     * 2. Diagnóstico (LEGACY)
     */
    const diagnostico = gerarDiagnostico(dadosProcessados);

    /**
     * 3. Comparação (LEGACY)
     */
    const comparacao = compararExames(
      dadosProcessados,
      anterior_dados_processados || null,
    );

    /**
     * 4. 🆕 Processamento BioSync Engine
     */
    console.log("🔍 Iniciando processamento BioSync...");
    console.log("📦 Modo selecionado:", modo_analise);
    console.log("⚖️ Peso/Altura:", peso_cliente, altura_cliente_metros);

    const rawItems = converterParaEngineBioSync(dadosProcessados);
    
    console.log("🔎 DEBUG - Primeiros 5 itens normalizados:");
    console.log(rawItems.slice(0, 5).map(i => ({
      nome: i.nome,
      percentual: i.percentual,
      categoria: i.categoria
    })));

    // ✅ Inicializa com fallback para garantir que sempre exista
    let biosyncResult: Awaited<ReturnType<typeof processBioSyncData>> = {
      modo_selecionado: modo_analise,
      category_scores: { fitness: 0, emocional: 0, sono: 0, imunidade: 0, mental: 0 },
      critical_alerts: [],
      quick_wins: [],
      imc_value: null,
      imc_status: null,
      translated_items: [],
      suggested_protocol: { therapies: [], checklist: [], timeline: '' }
    };

    try {
      biosyncResult = await processBioSyncData(
        rawItems,
        modo_analise,
        peso_cliente,
        altura_cliente_metros
      );

      console.log("✅ BioSync Processado com sucesso!");
      console.log("📊 Scores:", biosyncResult.category_scores);
      console.log("🚨 Alertas Críticos:", biosyncResult.critical_alerts.length);
      
      // 🧪 Log do resultado REAL (após processamento)
      console.log("🧪 RESULTADO DA ENGINE (pós-processamento):");
      console.log(JSON.stringify({
        scores: biosyncResult.category_scores,
        criticos: biosyncResult.critical_alerts.map(c => c.item)
      }, null, 2));

    } catch (engineError: any) {
      console.error("❌ ERRO NA ENGINE BIOSYNC:", engineError.message);
      console.error("📉 Stack:", engineError.stack);
      // Mantém o fallback definido acima
    }

    /**
     * 5. Plano terapêutico
     */
    const plano_terapeutico = gerarPlanoTerapeutico(diagnostico);

    /**
     * 6. ✅ Resposta (HÍBRIDA: legado + BioSync)
     */
    const resposta = {
      interpretacao:
        "Análise baseada em bioressonância com identificação de desequilíbrios energéticos e físicos.",

      pontos_criticos: diagnostico.problemas
        .filter((p) => p.prioridade === "alta")
        .map((p) => `${p.sistema} - ${p.item}`),

      plano_terapeutico,

      frequencia_lunara: "Frequência personalizada baseada no campo energético do cliente",

      justificativa:
        "Plano terapêutico estruturado com base nos principais desequilíbrios identificados.",

      // 🆕 NOVOS CAMPOS BIOSYNC
      modo_selecionado: biosyncResult.modo_selecionado,
      category_scores: biosyncResult.category_scores,
      critical_alerts: biosyncResult.critical_alerts,
      quick_wins: biosyncResult.quick_wins,
      imc_value: biosyncResult.imc_value,
      imc_status: biosyncResult.imc_status,
      translated_items: biosyncResult.translated_items,
      suggested_protocol: biosyncResult.suggested_protocol,
    };
    
    /**
     * 7. 💾 SALVAR EM EXAMES (Tabela real do fluxo)
     */
    try {
      // ✅ Usa o import estático do topo (não precisa de dynamic import)
      const targetExameId = exame_id || req.body.exame_id;
      
      if (targetExameId) {
        await atualizarExameComBioSync(targetExameId, {
          modo_selecionado: biosyncResult.modo_selecionado,
          category_scores: biosyncResult.category_scores,
          critical_alerts: biosyncResult.critical_alerts,
          quick_wins: biosyncResult.quick_wins,
          imc_value: biosyncResult.imc_value,
          imc_status: biosyncResult.imc_status,
          suggested_protocol: biosyncResult.suggested_protocol,
          translated_items: biosyncResult.translated_items
        });
        console.log('[DB:INFO] Exame atualizado com BioSync', { exameId: targetExameId });
      } else {
        console.warn('[DB:WARN] exame_id não informado. BioSync processado mas não salvo.');
      }
    } catch (saveError: any) {
      console.error('[DB:ERROR] Falha ao salvar exame:', saveError.message);
      // Não bloqueia a resposta ao frontend
    }

    return res.json({
      data: resposta,
      raw: JSON.stringify(resposta),
      dadosProcessados,
      diagnostico,
      comparacao,
      plano_terapeutico,
      biosync: biosyncResult,
      reused: false,
    });
  } catch (error: any) {
    console.error("Erro /api/analyze:", error);

    return res.status(500).json({
      error: "Erro ao processar análise",
      details: error?.message,
    });
  }
});

export default router;