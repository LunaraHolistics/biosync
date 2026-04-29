// ============================================================
// MOTOR SEMÂNTICO BIOSYNC v2
// Arquivo: Frontend/src/lib/motorSemantico.ts
// ============================================================

import type {
  ExameRow,
  TerapiaRow,
  BaseAnaliseSaudeRow,
} from "../services/db";

// ==============================
// TIPOS INTERNOS
// ==============================

export type Gravidade =
  | "leve"
  | "moderada"
  | "critica"
  | "reducao";

export type ItemAlterado = {
  item: string;
  itemNormalizado: string;
  valor: string;
  intervalo: string;
  resultadoOriginal: string;
  gravidade: Gravidade;
  scoreGravidade: number;
};

export type MatchClinico = {
  itemExame: string;
  itemBase: string;
  categoria: string;
  descricaoTecnica: string;
  impacto: string;
  setores: string[];
  scoreConfianca: number;
  gravidade: Gravidade;
  score?: number; // 🔥 NOVO: score calculado para item_scores
};

export type TerapiaSugerida = TerapiaRow & {
  scoreRelevancia: number;
  motivos: string[];
};

export type AnaliseCompleta = {
  paciente: {
    nome: string;
    sexo: string;
    idade: string;
    peso: string;
    altura: string;
    imc: number | null;
    classificacaoImc: string;
    figura: string;
    periodoTeste: string;
  };
  itensAlterados: ItemAlterado[];
  matches: MatchClinico[];
  interpretacao: string;
  pontosCriticos: string[];
  terapias: TerapiaSugerida[];
  scoreGeral: number;
  statusScore: string;
  percentual: number;
  setoresAfetados: string[];
  resumoCategorias: Record<string, { total: number; criticos: number }>;
  frequencia_lunara: string;
};

// ==============================
// 🔥 PESOS EMOCIONAIS PADRÃO (FALLBACK PARA ITENS SEM BASE)
// ==============================
const PESOS_EMOCIONAIS_PADRAO: Record<string, number> = {
  'amor': 75, 'alegria': 70, 'paz': 65, 'iluminismo': 50,
  'vergonha': 30, 'culpa': 25, 'apatia': 20, 'medo': 35,
  'desejo': 45, 'raiva': 40, 'orgulho': 55, 'coragem': 60,
  'neutralidade': 50, 'vontade': 65, 'aceitacao': 70, 'razao': 75,
  'tristeza': 35, 'ansiedade': 30, 'depressao': 25, 'estresse': 35,
  'frustracao': 40, 'inseguranca': 35, 'solidao': 30, 'luto': 25,
  'confianca': 70, 'esperanca': 75, 'gratidao': 80, 'compaixao': 75
};

// ==============================
// 1. DECODIFICADOR DE MOJIBAKE
// ==============================

export function decodificarMojibake(texto: string): string {
  if (!texto) return texto;
  try {
    const bytes = new Uint8Array(
      [...texto].map((c) => c.charCodeAt(0))
    );
    const decoder = new TextDecoder("utf-8");
    const resultado = decoder.decode(bytes);
    if (resultado.includes("\uFFFD")) return texto;
    return resultado;
  } catch {
    return texto;
  }
}

// ==============================
// 2. NORMALIZADOR DE TEXTO
// ==============================

const ACCENT_MAP: Record<string, string> = {
  á: "a", à: "a", ã: "a", â: "a", ä: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", õ: "o", ô: "o", ö: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ç: "c", ñ: "n",
};

function removerAcentos(texto: string): string {
  return texto
    .toLowerCase()
    .replace(
      /[áàãâäéèêëíìîïóòõôöúùûüçñ]/g,
      (m) => ACCENT_MAP[m] || m
    );
}

export function normalizarTexto(texto: string): string {
  return removerAcentos(texto)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ==============================
// 3. PARSER DE PACIENTE
// ==============================

export function parsearPaciente(nomePaciente: string): AnaliseCompleta["paciente"] {
  const decodificado = decodificarMojibake(nomePaciente);

  const extrair = (regex: RegExp, fallback = ""): string => {
    const match = decodificado.match(regex);
    return match ? match[1].trim() : fallback;
  };

  const nome = extrair(/^(.+?)(?=Sexo:|$)/);
  const sexo = extrair(/Sexo:\s*([^\dI]+)/);
  const idade = extrair(/Idade:\s*(\d+)/);

  const pesoStr = extrair(/Peso:\s*([\d.,]+)\s*kg/i) || "";
  const alturaStr = extrair(/Altura:\s*([\d.,]+)\s*m/i) || "";

  let imc: number | null = null;
  let classificacaoImc = "";

  const pesoNum = parseFloat(pesoStr.replace(",", "."));
  const alturaNum = parseFloat(alturaStr.replace(",", "."));

  if (pesoNum > 0 && alturaNum > 0) {
    imc = pesoNum / (alturaNum * alturaNum);
    if (imc < 18.5) classificacaoImc = "Abaixo do peso";
    else if (imc < 25) classificacaoImc = "Normal";
    else if (imc < 30) classificacaoImc = "Sobrepeso";
    else classificacaoImc = "Obesidade";
  }

  const figura = extrair(/Figura:\s*(.+?)(?=Per[ií]odo|$)/);
  const periodoTeste = extrair(/Per[ií]odo do teste:\s*(.+)$/);

  return { nome, sexo, idade, peso: pesoStr, altura: alturaStr, imc, classificacaoImc, figura, periodoTeste };
}

// ==============================
// 4. CLASSIFICADOR DE GRAVIDADE
// ==============================

function classificarGravidade(resultado: string): {
  gravidade: Gravidade;
  score: number;
} {
  const lower = resultado.toLowerCase();

  if (
    lower.includes("moderadamente") ||
    lower.includes("++")
  ) {
    return { gravidade: "moderada", score: 3 };
  }
  if (
    lower.includes("severamente") ||
    lower.includes("+++")
  ) {
    return { gravidade: "critica", score: 4 };
  }
  if (
    lower.includes("ligeiramente") ||
    lower.includes("(+)")
  ) {
    return { gravidade: "leve", score: 1 };
  }
  if (lower.includes("redu")) {
    return { gravidade: "reducao", score: 2 };
  }

  return { gravidade: "leve", score: 1 };
}

// ==============================
// 5. EXTRATOR DE ITENS ALTERADOS (CORRIGIDO)
// ==============================

function ehNormal(resultado: string): boolean {
  const decodificado = decodificarMojibake(resultado);
  const lower = decodificado.toLowerCase().trim();

  return (
    lower === "normal(-)" ||
    lower === "normal" ||
    lower === "escopo de saúde" ||
    lower === "escopo de saude"
  );
}

export function extrairItensAlterados(
  resultadoJson: any
): ItemAlterado[] {
  if (!resultadoJson) return [];

  const itens: ItemAlterado[] = [];

  // 🔥 SUPORTE AO FORMATO DO CONTENT.JS
  if (resultadoJson.problemas) {
    for (const p of resultadoJson.problemas) {
      if (!p.item || !p.status) continue;

      const resultadoDecodificado = decodificarMojibake(
        String(p.status)
      );

      if (ehNormal(resultadoDecodificado)) continue;

      const { gravidade, score } =
        classificarGravidade(resultadoDecodificado);

      const itemDecodificado = decodificarMojibake(
        String(p.item)
      );

      itens.push({
        item: itemDecodificado,
        itemNormalizado: normalizarTexto(itemDecodificado),
        valor: String(p.valor ?? ""),
        intervalo: "",
        resultadoOriginal: resultadoDecodificado,
        gravidade,
        scoreGravidade: score,
      });
    }

    return itens;
  }

  // 🔥 FORMATO ORIGINAL (mantido)
  let analises: any[] = [];

  if (Array.isArray(resultadoJson)) {
    for (const item of resultadoJson) {
      if (item?.analises && Array.isArray(item.analises)) {
        analises = item.analises;
        break;
      }
    }
  } else if (typeof resultadoJson === "object") {
    analises = resultadoJson.analises ?? [];
  }

  for (const bloco of analises) {
    const resultados = bloco.resultados ?? [];

    for (const r of resultados) {
      if (!r.item || !r.resultado) continue;

      const resultadoDecodificado = decodificarMojibake(
        String(r.resultado)
      );

      if (ehNormal(resultadoDecodificado)) continue;

      const { gravidade, score: scoreGravidade } =
        classificarGravidade(resultadoDecodificado);

      const itemDecodificado = decodificarMojibake(
        String(r.item)
      );

      itens.push({
        item: itemDecodificado,
        itemNormalizado: normalizarTexto(itemDecodificado),
        valor: String(r.valor ?? ""),
        intervalo: String(r.intervalo ?? ""),
        resultadoOriginal: resultadoDecodificado,
        gravidade,
        scoreGravidade,
      });
    }
  }

  return itens;
}

// ==============================
// 6. MATCH SEMÂNTICO COM BASE CLÍNICA (CORRIGIDO)
// ==============================

function calcularSimilaridade(
  a: string,
  b: string
): number {
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 85;

  const palavrasA = new Set(
    a.split(" ").filter((p) => p.length > 2)
  );
  const palavrasB = new Set(
    b.split(" ").filter((p) => p.length > 2)
  );

  let comuns = 0;
  for (const p of palavrasA) {
    if (palavrasB.has(p)) comuns++;
  }

  const total = Math.max(
    palavrasA.size,
    palavrasB.size
  );
  if (total === 0) return 0;

  return Math.round((comuns / total) * 100);
}

// 🔥 FUNÇÃO AUXILIAR: Calcular score para um item (com fallback emocional)
function calcularScoreParaItem(
  itemBase: string,
  categoria: string,
  gravidade: Gravidade
  ): number {
  // 1. Fallback: usar pesos emocionais padrão se for categoria emotional
  if (categoria.toLowerCase() === 'emotional' || categoria.toLowerCase() === 'emocional') {
    const itemNorm = normalizarTexto(itemBase);
    for (const [key, peso] of Object.entries(PESOS_EMOCIONAIS_PADRAO)) {
      if (itemNorm.includes(key) || key.includes(itemNorm)) {
        return peso;
      }
    }
    // Default para emocional sem match específico
    return 50;
  }

  // 2. Fallback genérico baseado na gravidade
  switch (gravidade) {
    case 'critica': return 25;
    case 'moderada': return 40;
    case 'leve': return 60;
    case 'reducao': return 55;
    default: return 50;
  }
}

function buscarMatches(
  itensAlterados: ItemAlterado[],
  base: BaseAnaliseSaudeRow[]
): MatchClinico[] {
  const matches: MatchClinico[] = [];

  const baseNormalizada = base.map((b) => ({
    ...b,
    itemNorm: normalizarTexto(
      decodificarMojibake(b.item ?? "")
    ),
    descNorm: normalizarTexto(
      decodificarMojibake(b.descricao_tecnica ?? "")
    ),
    impactoNorm: normalizarTexto(
      decodificarMojibake(b.impacto ?? "")
    ),
  }));

  for (const item of itensAlterados) {
    let melhorMatch: MatchClinico | null = null;
    let melhorScore = 0;

    for (const b of baseNormalizada) {
      if (!b.itemNorm) continue;

      const scoreItem = calcularSimilaridade(
        item.itemNormalizado,
        b.itemNorm
      );

      const scoreDesc = item.itemNormalizado
        .split(" ")
        .some(
          (palavra) =>
            palavra.length > 3 &&
            b.descNorm.includes(palavra)
        )
        ? 60
        : 0;

      const scoreFinal = Math.max(scoreItem, scoreDesc);

      if (
        scoreFinal > melhorScore &&
        scoreFinal >= 50
      ) {
        melhorScore = scoreFinal;
        
        // 🔥 Calcular score para este match (com fallback emocional)
        const scoreCalculado = calcularScoreParaItem(
          b.item ?? item.item,
          b.categoria ?? 'Outros',
          item.gravidade,
          base
        );

        melhorMatch = {
          itemExame: item.item,
          itemBase: b.item ?? item.item,
          categoria: b.categoria || "Outros",
          descricaoTecnica: b.descricao_tecnica || "",
          impacto: b.impacto || "",
          setores: (b.setores ?? []).map((s) =>
            normalizarTexto(s)
          ),
          scoreConfianca: scoreFinal,
          gravidade: item.gravidade,
          score: scoreCalculado, // 🔥 INCLUÍDO para item_scores
        };
      }
    }

    // 🔥 Se não encontrou match na base, cria um match genérico com score fallback
    if (!melhorMatch) {
      const scoreFallback = calcularScoreParaItem(
        item.item,
        'Outros',
        item.gravidade,
        base
      );

      matches.push({
        itemExame: item.item,
        itemBase: item.item,
        categoria: "Outros",
        descricaoTecnica: "",
        impacto: item.resultadoOriginal,
        setores: [],
        scoreConfianca: 50,
        gravidade: item.gravidade,
        score: scoreFallback, // 🔥 INCLUÍDO para item_scores
      });
    } else {
      matches.push(melhorMatch);
    }
  }

  return matches.sort(
    (a, b) => b.scoreConfianca - a.scoreConfianca
  );
}

// ==============================
// 7. GERADOR DE INTERPRETAÇÃO
// ==============================
function gerarInterpretacao(matches: MatchClinico[], setoresTop: string[]): string {
  if (matches.length === 0) {
    return "Exame dentro dos parâmetros de normalidade. Nenhum desvio significativo identificado.";
  }

  const secoes: string[] = [];

  const setoresFormatados = setoresTop.length > 1
    ? setoresTop.slice(0, -1).join(", ") + " e " + setoresTop[setoresTop.length - 1]
    : setoresTop[0] || "geral";

  secoes.push(
    `Foram identificados desequilíbrios relevantes com maior impacto nos sistemas ${setoresFormatados}. A análise abaixo detalha os principais pontos de atenção agrupados por área.`
  );

  const grupos: Record<string, MatchClinico[]> = {};
  for (const m of matches) {
    const cat = m.categoria;
    if (!cat || cat.toLowerCase() === "outros") continue;
    if (!grupos[cat]) grupos[cat] = [];
    grupos[cat].push(m);
  }

  const categoriasTop = Object.entries(grupos)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);

  for (const [categoria, itens] of categoriasTop) {
    let textoCat = `\n► ${categoria.toUpperCase()}\n`;

    const itensRelevantes = itens
      .sort((a, b) => b.scoreConfianca - a.scoreConfianca)
      .slice(0, 3);

    for (const item of itensRelevantes) {
      const gravidadeTag = (item.gravidade === "critica" || item.gravidade === "moderada") ? "⚠️ " : "• ";

      const detalhe = item.impacto
        ? `${item.itemBase}: ${item.impacto}`
        : `${item.itemBase} apresentando alteração (${item.gravidade}).`;

      textoCat += `${gravidadeTag}${detalhe}\n`;
    }

    secoes.push(textoCat);
  }

  secoes.push(
    `\nConclusão: Recomenda-se abordagem terapêutica integrativa focada no reequilíbrio dos sistemas supracitados, priorizando a modulação do estresse fisiológico e a correção dos desvios identificados.`
  );

  return secoes.join("\n");
}

// ==============================
// 8. GERADOR DE PONTOS CRÍTICOS
// ==============================
function gerarPontosCriticos(matches: MatchClinico[], itensAlterados: ItemAlterado[]): string[] {
  const pontos: string[] = [];

  const comImpacto = matches
    .filter((m) => m.impacto)
    .sort((a, b) => {
      const pa = (a.gravidade === "moderada" || a.gravidade === "critica") ? 1 : 0;
      const pb = (b.gravidade === "moderada" || b.gravidade === "critica") ? 1 : 0;
      return pb - pa;
    });

  for (const m of comImpacto.slice(0, 7)) {
    pontos.push(`${m.itemBase}: ${m.impacto}`);
  }

  const semMatch = itensAlterados.filter(
    (ia) => !matches.some((m) => m.itemExame === ia.item) && ia.scoreGravidade >= 3
  );

  for (const s of semMatch.slice(0, 3)) {
    pontos.push(`${s.item} — ${s.resultadoOriginal}`);
  }

  return pontos;
}

// ==============================
// 9. SUGESTOR DE TERAPIAS (CORRIGIDO)
// ==============================

function sugerirTerapias(
  matches: MatchClinico[],
  terapias: TerapiaRow[]
): TerapiaSugerida[] {
  const setoresComPeso = new Map<string, number>();

  for (const m of matches) {
    const peso =
      m.gravidade === "moderada"
        ? 2
        : m.gravidade === "critica"
          ? 3
          : 1;
    for (const s of m.setores) {
      if (s) setoresComPeso.set(
        s,
        (setoresComPeso.get(s) ?? 0) + peso
      );
    }
  }

  if (setoresComPeso.size === 0) {
    return [];
  }

  const resultados: TerapiaSugerida[] = [];

  for (const terapia of terapias) {
    if (!terapia.ativo) continue;

    const tagsNorm = new Set(
      (terapia.tags ?? []).map((t) => normalizarTexto(t))
    );
    const setoresNorm = new Set(
      (terapia.setores_alvo ?? []).map((s) => normalizarTexto(s))
    );

    const alvos = new Set([...tagsNorm, ...setoresNorm]);

    let scoreTotal = 0;
    const motivos: string[] = [];

    for (const [setor, peso] of setoresComPeso.entries()) {
      const setorNorm = normalizarTexto(setor);

      if (alvos.has(setorNorm)) {
        scoreTotal += peso;
        motivos.push(setor);
        continue;
      }

      for (const alvo of alvos) {
        if (
          alvo.length > 3 &&
          (alvo.includes(setorNorm) || setorNorm.includes(alvo))
        ) {
          if (!motivos.includes(setor)) {
            scoreTotal += Math.round(peso * 0.7);
            motivos.push(setor);
          }
          break;
        }
      }
    }

    if (scoreTotal > 0) {
      resultados.push({
        ...terapia,
        scoreRelevancia: scoreTotal,
        motivos: [...new Set(motivos)],
      });
    }
  }

  if (resultados.length === 0) {
    return [];
  }

  return resultados.sort(
    (a, b) => b.scoreRelevancia - a.scoreRelevancia
  );
}

// ==============================
// 10. SCORE GERAL (CURVA SUAVIZANTE)
// ==============================
export function calcularScoreGeral(
  itensAlterados: ItemAlterado[],
  totalScanned: number = 300
): { score: number; status: string; percentual: number } {
  if (itensAlterados.length === 0) {
    return { score: 100, status: "Ótimo", percentual: 0 };
  }

  let pesoDoenca = 0;
  for (const item of itensAlterados) {
    switch (item.gravidade) {
      case "critica": pesoDoenca += 3; break;
      case "moderada": pesoDoenca += 2; break;
      case "leve": pesoDoenca += 1; break;
      case "reducao": pesoDoenca += 1; break;
    }
  }

  const pesoMaximo = totalScanned * 3;
  const porcentagemImpacto = Math.min(1, pesoDoenca / pesoMaximo);

  const score = Math.max(0, Math.round(100 - (Math.pow(porcentagemImpacto, 1.2) * 100)));

  let status: string;
  if (score >= 85) status = "Ótimo";
  else if (score >= 65) status = "Bom";
  else if (score >= 40) status = "Atenção";
  else if (score >= 20) status = "Cuidado";
  else status = "Crítico";

  return {
    score,
    status,
    percentual: Math.round(porcentagemImpacto * 100)
  };
}

// ==============================
// 11. RESUMO POR CATEGORIA
// ==============================

function gerarResumoCategorias(
  matches: MatchClinico[]
): Record<
  string,
  { total: number; criticos: number }
> {
  const resumo: Record<
    string,
    { total: number; criticos: number }
  > = {};

  for (const m of matches) {
    const cat = m.categoria || "Outros";
    if (!resumo[cat])
      resumo[cat] = { total: 0, criticos: 0 };
    resumo[cat].total++;
    if (
      m.gravidade === "moderada" ||
      m.gravidade === "critica"
    ) {
      resumo[cat].criticos++;
    }
  }

  return resumo;
}

// ==============================
// 🔥 FUNÇÃO PRINCIPAL (CURADA E TIPADA 100%)
// ==============================
export function gerarAnaliseCompleta(
  exame: ExameRow,
  base: BaseAnaliseSaudeRow[],
  terapias: TerapiaRow[]
): AnaliseCompleta {
  const paciente = parsearPaciente(exame.nome_paciente);
  let itensAlterados = extrairItensAlterados(exame.resultado_json);

  // 🔥 BLINDAGEM ANTI-LIXO DE BANCO DE DADOS ANTIGO
  const mapaDedupMotor = new Map<string, ItemAlterado>();
  itensAlterados.forEach(item => {
    mapaDedupMotor.set(item.itemNormalizado, item);
  });
  itensAlterados = Array.from(mapaDedupMotor.values());

  const matches = buscarMatches(itensAlterados, base);

  // 🔥 SETORES AFETADOS CORRIGIDOS
  const contagemSetores = new Map<string, number>();
  matches.forEach((m) => {
    if (Array.isArray(m.setores)) {
      m.setores.forEach((s) => {
        if (s) contagemSetores.set(s, (contagemSetores.get(s) || 0) + 1);
      });
    }
  });

  const setoresAfetados: string[] = Array.from(contagemSetores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([setor]) => setor);

  const interpretacao = gerarInterpretacao(matches, setoresAfetados);
  const pontosCriticos = gerarPontosCriticos(matches, itensAlterados);

  let terapiasSugeridas = sugerirTerapias(matches, terapias);

  if (itensAlterados.length === 0) {
    terapiasSugeridas = terapias
      .filter((t) => t.ativo)
      .sort((a, b) => (a.prioridade ?? 99) - (b.prioridade ?? 99))
      .slice(0, 2)
      .map((t) => ({ ...t, scoreRelevancia: 1, motivos: ["manutenção preventiva"] }));
  }

  const { score: scoreGeral, status: statusScore, percentual } =
    calcularScoreGeral(itensAlterados, 300);
  const resumoCategorias = gerarResumoCategorias(matches);

  // 🔥 ENRIQUECIMENTO FINAL
  const matchesComFitness = matches.map(m => ({
    ...m,
    impacto_fitness: mapearImpactoFitness(m.categoria, m.gravidade, paciente.imc)
  }));

  const frequenciaSugerida = sugerirFrequenciaSolfeggio(setoresAfetados);

  return {
    paciente,
    itensAlterados,
    matches: matchesComFitness,
    interpretacao,
    pontosCriticos,
    terapias: terapiasSugeridas,
    scoreGeral,
    statusScore,
    percentual,
    setoresAfetados,
    resumoCategorias,
    frequencia_lunara: frequenciaSugerida,
  };
}

// ==============================
// IMPACTO FITNESS (MAPEAMENTO CLÍNICO EXPANDIDO)
// ==============================
type ImpactoFitnessType = {
  performance?: string;
  hipertrofia?: string;
  emagrecimento?: string;
  recuperacao?: string;
  humor?: string;
} | null;

function mapearImpactoFitness(categoria: string, gravidade: Gravidade, imc: number | null): ImpactoFitnessType {
  const catNorm = normalizarTexto(categoria);

  const focarEmagrecimento = imc !== null && imc >= 25;

  if (catNorm.includes('metabolismo') || catNorm.includes('gordura') || catNorm.includes('obesidade')) {
    return {
      emagrecimento: focarEmagrecimento
        ? `IMC de ${imc?.toFixed(1)} indica sobrepeso/obesidade. Metabolismo severamente comprometido. Necessidade urgente de déficit calórico aliado a treino HIIT para ativar a lipólise.`
        : gravidade === 'critica'
          ? 'Metabolismo severamente comprometido, dificuldade alta de redução.'
          : 'Metabolismo lento, requer estímulo dietético e treino intervalado.',
      performance: focarEmagrecimento
        ? 'Queda significativa de energia disponível para treinos de alta intensidade.'
        : 'Queda de energia disponível para treinos.'
    };
  }

  if (catNorm.includes('muscular') || catNorm.includes('articul') || catNorm.includes('osseo') || catNorm.includes('colageno')) {
    return {
      hipertrofia: gravidade === 'critica' ? 'Risco de lesão. Foco em reparo antes de carga.' : 'Capacidade de recuperação entre séries reduzida.',
      recuperacao: 'Dor ou inflamação aumentam o tempo de repouso necessário.'
    };
  }

  if (catNorm.includes('cardiovascular') || catNorm.includes('pulmonar') || catNorm.includes('sangu')) {
    return {
      performance: 'Capacidade aeróbica reduzida, fadiga precoce.',
      recuperacao: 'Frequência cardíaca de repouso alterada.'
    };
  }

  if (catNorm.includes('nervoso') || catNorm.includes('emocional') || catNorm.includes('consciencia')) {
    return {
      humor: 'Instabilidade afetando motivação e foco.',
      performance: 'Foco e concentração prejudicados durante o treino.'
    };
  }

  if (catNorm.includes('mineral') || catNorm.includes('vitamina') || catNorm.includes('aminoacido')) {
    return {
      recuperacao: 'Deficiência de micronutrientes prejudica reparo tecidual e contração muscular.',
      performance: 'Fadiga crônica e falta de energia celular (ATP).'
    };
  }

  if (catNorm.includes('imunologico') || catNorm.includes('linfonodo') || catNorm.includes('timo')) {
    return {
      recuperacao: 'Sistema imune baixo pode gerar inflamações crônicas que atrasam o ganho de massa.',
      humor: 'Vulnerabilidade a doenças pode causar fadiga e desânimo.'
    };
  }

  return null;
}

// ==============================
// PROTOCOLO SOLFEGGIO COMBINADO (EXPANDIDO)
// ==============================
function sugerirFrequenciaSolfeggio(setoresAfetados: string[]): string {
  const setoresNorm = setoresAfetados.map(s => normalizarTexto(s));
  const frequenciasEscolhidas = new Set<string>();

  for (const setor of setoresNorm) {
    if (setor.includes('emocional') || setor.includes('mental') || setor.includes('consciencia')) {
      frequenciasEscolhidas.add("396");
      frequenciasEscolhidas.add("432");
    }

    if (setor.includes('fisico') || setor.includes('imunologico') || setor.includes('metabolismo') || setor.includes('cardiovascular') || setor.includes('digestivo')) {
      frequenciasEscolhidas.add("528");
    }

    if (setor.includes('endocrino') || setor.includes('hormonal') || setor.includes('ginecologico')) {
      frequenciasEscolhidas.add("639");
    }

    if (setor.includes('espiritual')) {
      frequenciasEscolhidas.add("852");
      frequenciasEscolhidas.add("963");
    }

    if (setor.includes('desintox') || setor.includes('figado') || setor.includes('renal')) {
      frequenciasEscolhidas.add("741");
    }
  }

  if (frequenciasEscolhidas.size === 0) {
    frequenciasEscolhidas.add("432");
  }

  const mapDescricoes: Record<string, string> = {
    "396": "396Hz (Libertação) — Transforma sentimentos de medo, culpa e desamparo em poder pessoal. Base para liberação emocional profunda.",
    "432": "432Hz (Ancoramento) — Acalma o sistema nervoso central, reduz ansiedade e abre os canais de aceitação da terapia.",
    "528": "528Hz (Reparo e Imunidade) — Frequência de 'milagres'. Estimula reparo de DNA celular, regeneração de tecidos e fortalecimento imunológico.",
    "639": "639Hz (Equilíbrio Hormonal) — Reconecta sistemas internos, reequilibra o sistema endócrino e harmoniza relações interpessoais.",
    "741": "741Hz (Desintoxicação) — Purifica células de toxinas físicas, emocionais e eletromagnéticas. Ativa processos intuitivos.",
    "852": "852Hz (Intuição Espiritual) — Estimula o retorno à ordem espiritual, indicada para alinhamento multidimensional e percepção expandida.",
    "963": "963Hz (Conexão Divina) — Ativa a glândula pineal, estimulando estados de consciência elevada e ordem neurológica superior."
  };

  return Array.from(frequenciasEscolhidas).map(hz => `🎵 ${mapDescricoes[hz]}`).join("\n");
}

// ==============================
// COMPARATIVO INTELIGENTE
// ==============================
export type ItemComparativo = {
  sistema: string;
  item: string;
  antes: "baixo" | "normal" | "alto" | null;
  depois: "baixo" | "normal" | "alto" | null;
  valor_antes?: number;
  valor_depois?: number;
  variacao?: number;
  evolucao: "melhora" | "piora" | "novo" | "normalizado";
};

export type ComparativoInteligente = {
  melhoraram: ItemComparativo[];
  pioraram: ItemComparativo[];
  novos_problemas: ItemComparativo[];
  normalizados: ItemComparativo[];
};

const COMPARATIVO_VAZIO: ComparativoInteligente = {
  melhoraram: [], pioraram: [], novos_problemas: [], normalizados: [],
};

function classificarStatus(resultado: string): "baixo" | "normal" | "alto" | null {
  const decodificado = decodificarMojibake(resultado);
  const lower = decodificado.toLowerCase();
  if (ehNormal(decodificado)) return "normal";
  if (lower.includes("redu")) return "baixo";
  if (lower.includes("anormal") || lower.includes("severe") || lower.includes("moderate")) return "alto";
  return "alto";
}

export function gerarComparativoInteligente(exames: ExameRow[]): ComparativoInteligente {
  if (exames.length < 2) return COMPARATIVO_VAZIO;

  const resultado: ComparativoInteligente = { melhoraram: [], pioraram: [], novos_problemas: [], normalizados: [] };
  const anterior = exames[exames.length - 2];
  const atual = exames[exames.length - 1];

  const itensAntes = extrairItensAlterados(anterior.resultado_json);
  const itensDepois = extrairItensAlterados(atual.resultado_json);

  const mapaAntes = new Map<string, ItemAlterado>();
  for (const ia of itensAntes) mapaAntes.set(ia.itemNormalizado, ia);

  const mapaDepois = new Map<string, ItemAlterado>();
  for (const id of itensDepois) mapaDepois.set(id.itemNormalizado, id);

  for (const [key, itemAntes] of mapaAntes) {
    if (!mapaDepois.has(key)) {
      resultado.normalizados.push({
        sistema: "Geral", item: itemAntes.item, antes: "alto", depois: "normal",
        valor_antes: parseFloat(itemAntes.valor) || undefined, evolucao: "normalizado",
      });
    }
  }

  for (const [key, itemDepois] of mapaDepois) {
    const itemAntes = mapaAntes.get(key);

    if (itemAntes) {
      const diff = itemDepois.scoreGravidade - itemAntes.scoreGravidade;
      if (diff === 0) continue;

      const comp: ItemComparativo = {
        sistema: "Geral", item: itemDepois.item,
        antes: classificarStatus(itemAntes.resultadoOriginal),
        depois: classificarStatus(itemDepois.resultadoOriginal),
        valor_antes: parseFloat(itemAntes.valor) || undefined,
        valor_depois: parseFloat(itemDepois.valor) || undefined,
        variacao: diff, evolucao: diff < 0 ? "melhora" : "piora",
      };

      if (diff < 0) resultado.melhoraram.push(comp);
      else if (diff > 0) resultado.pioraram.push(comp);
    } else {
      if (itemDepois.scoreGravidade >= 2) {
        resultado.novos_problemas.push({
          sistema: "Geral", item: itemDepois.item, antes: null,
          depois: classificarStatus(itemDepois.resultadoOriginal),
          valor_depois: parseFloat(itemDepois.valor) || undefined, evolucao: "novo",
        });
      }
    }
  }

  resultado.melhoraram = resultado.melhoraram.sort((a, b) => (a.variacao || 0) - (b.variacao || 0)).slice(0, 10);
  resultado.pioraram = resultado.pioraram.sort((a, b) => (b.variacao || 0) - (a.variacao || 0)).slice(0, 10);
  resultado.novos_problemas = resultado.novos_problemas.slice(0, 5);
  resultado.normalizados = resultado.normalizados.slice(0, 10);

  return resultado;
}