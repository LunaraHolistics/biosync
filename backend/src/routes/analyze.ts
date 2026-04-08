import { Router } from "express";
import { parseBioressonancia } from "../utils/parserBio";
import { gerarDiagnostico } from "../services/diagnostico.service";

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
 * Geração simples de plano terapêutico (BASE - pode evoluir depois)
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
};

router.post("/api/analyze", async (req, res) => {
  try {
    const { prompt, anterior_dados_processados } =
      req.body as AnalyzeRequest;

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
     * 2. Diagnóstico
     */
    const diagnostico = gerarDiagnostico(dadosProcessados);

    /**
     * 3. Comparação
     */
    const comparacao = compararExames(
      dadosProcessados,
      anterior_dados_processados || null,
    );

    /**
     * 4. Plano terapêutico (🔥 NOVO MODELO)
     */
    const plano_terapeutico = gerarPlanoTerapeutico(diagnostico);

    /**
     * 5. Resposta
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
    };

    return res.json({
      data: resposta,
      raw: JSON.stringify(resposta),
      dadosProcessados,
      diagnostico,
      comparacao,
      plano_terapeutico,
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