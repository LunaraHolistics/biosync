import { Router } from "express";
import { parseBioressonancia } from "../utils/parserBio";
import { gerarDiagnostico } from "../services/diagnostico.service";
import { processBioSyncData } from "../services/engine-processor";

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
 */
function converterParaEngineBioSync(dadosProcessados: ReturnType<typeof parseBioressonancia>) {
  return dadosProcessados.map(item => ({
    nome: item.item,
    percentual: item.valor,
    categoria: item.sistema
  }));
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
};

router.post("/api/analyze", async (req, res) => {
  try {
    const {
      prompt,
      anterior_dados_processados,
      modo_analise = 'fitness',
      peso_cliente,
      altura_cliente_metros
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
    console.log("🔎 DEBUG - Primeiros 5 itens do parser:");
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

    // Após: const biosyncResult = await processBioSyncData(...)
    console.log("🧪 RESULTADO BRUTO DA ENGINE:");
    console.log(JSON.stringify(biosyncResult, null, 2));

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

      // 🆕 NOVOS CAMPOS BIOSYNC (agora com biosyncResult garantido)
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
     * 7. 💾 SALVAR NO BANCO (Passo que estava faltando!)
     */
    try {
      const { salvarNovaAnalise } = await import("../db/analises.repository");

      // Gerar hash do PDF/texto original
      const crypto = await import('crypto');
      const pdfHash = crypto.createHash('md5').update(Array.isArray(prompt) ? prompt.join('') : prompt).digest('hex');

      await salvarNovaAnalise({
        cliente_id: 'e353bf87-9f93-4c86-9d52-e06c14c1d037', // 🔴 SUBSTITUA pelo ID real do cliente
        pdf_hash: pdfHash,

        // Dados legados
        raw_text: Array.isArray(prompt) ? prompt.join('\n') : prompt,
        result_text: JSON.stringify(resposta),
        dados_processados: dadosProcessados,
        diagnostico: diagnostico,
        comparacao: comparacao,
        plano_terapeutico: plano_terapeutico,

        // 🔥 NOVOS DADOS BIOSYNC
        modo_selecionado: biosyncResult.modo_selecionado,
        category_scores: biosyncResult.category_scores,
        critical_alerts: biosyncResult.critical_alerts,
        quick_wins: biosyncResult.quick_wins,
        imc_value: biosyncResult.imc_value,
        imc_status: biosyncResult.imc_status,
        suggested_protocol: biosyncResult.suggested_protocol,
      });

      console.log("✅ Análise salva no Supabase com sucesso!");

    } catch (saveError: any) {
      console.error("❌ ERRO AO SALVAR NO BANCO:", saveError.message);
      console.error("📉 Stack:", saveError.stack);
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