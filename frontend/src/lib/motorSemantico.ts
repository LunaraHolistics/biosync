// ============================================================
// MOTOR SEMÂNTICO BIOSYNC
// Arquivo: Frontend/src/lib/motorSemantico.ts
// Responsável: Análise inteligente sem dependência de analise_ia
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
  setoresAfetados: string[];
  resumoCategorias: Record<
    string,
    { total: number; criticos: number }
  >;
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
  á: "a",
  à: "a",
  ã: "a",
  â: "a",
  ä: "a",
  é: "e",
  è: "e",
  ê: "e",
  ë: "e",
  í: "i",
  ì: "i",
  î: "i",
  ï: "i",
  ó: "o",
  ò: "o",
  õ: "o",
  ô: "o",
  ö: "o",
  ú: "u",
  ù: "u",
  û: "u",
  ü: "u",
  ç: "c",
  ñ: "n",
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

export function parsearPaciente(
  nomePaciente: string
): AnaliseCompleta["paciente"] {
  const decodificado = decodificarMojibake(nomePaciente);

  const extrair = (
    regex: RegExp,
    fallback = ""
  ): string => {
    const match = decodificado.match(regex);
    return match ? match[1].trim() : fallback;
  };

  const nome = extrair(/^(.+?)(?=Sexo:|$)/);
  const sexo = extrair(/Sexo:\s*([^\dI]+)/);
  const idade = extrair(/Idade:\s*(\d+)/);
  const figura = extrair(
    /Figura:\s*(.+?)(?=Per[ií]odo|$)/
  );
  const periodoTeste = extrair(
    /Per[ií]odo do teste:\s*(.+)$/
  );

  return { nome, sexo, idade, figura, periodoTeste };
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
// 5. EXTRATOR DE ITENS ALTERADOS
// ==============================

function ehNormal(resultado: string): boolean {
  const lower = resultado.toLowerCase().trim();
  return (
    lower === "normal(-)" ||
    lower === "normal" ||
    lower === "escopo de saúde"
  );
}

export function extrairItensAlterados(
  resultadoJson: any
): ItemAlterado[] {
  if (!resultadoJson) return [];

  let analises: any[] = [];

  if (Array.isArray(resultadoJson)) {
    for (const item of resultadoJson) {
      if (
        item?.analises &&
        Array.isArray(item.analises)
      ) {
        analises = item.analises;
        break;
      }
    }
  } else if (typeof resultadoJson === "object") {
    analises = resultadoJson.analises ?? [];
  }

  const itens: ItemAlterado[] = [];

  for (const bloco of analises) {
    const resultados = bloco.resultados ?? [];
    for (const r of resultados) {
      if (!r.item || !r.resultado) continue;
      if (ehNormal(r.resultado)) continue;

      const { gravidade, score: scoreGravidade } =
        classificarGravidade(r.resultado);
      const itemDecodificado = decodificarMojibake(
        String(r.item)
      );

      itens.push({
        item: itemDecodificado,
        itemNormalizado: normalizarTexto(
          itemDecodificado
        ),
        valor: String(r.valor ?? ""),
        intervalo: String(r.intervalo ?? ""),
        resultadoOriginal: decodificarMojibake(
          String(r.resultado)
        ),
        gravidade,
        scoreGravidade,
      });
    }
  }

  return itens;
}

// ==============================
// 6. MATCH SEMÂNTICO COM BASE CLÍNICA
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

function buscarMatches(
  itensAlterados: ItemAlterado[],
  base: BaseAnaliseSaudeRow[]
): MatchClinico[] {
  const matches: MatchClinico[] = [];

  const baseNormalizada = base.map((b) => ({
    ...b,
    itemNorm: normalizarTexto(
      decodificarMojibake(b.item)
    ),
    descNorm: normalizarTexto(
      decodificarMojibake(b.descricao_tecnica)
    ),
    impactoNorm: normalizarTexto(
      decodificarMojibake(b.impacto ?? "")
    ),
  }));

  for (const item of itensAlterados) {
    let melhorMatch: MatchClinico | null = null;
    let melhorScore = 0;

    for (const b of baseNormalizada) {
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

      const scoreImpacto = item.itemNormalizado
        .split(" ")
        .some(
          (palavra) =>
            palavra.length > 3 &&
            b.impactoNorm.includes(palavra)
        )
        ? 40
        : 0;

      const scoreFinal = Math.max(
        scoreItem,
        scoreDesc,
        scoreImpacto
      );

      if (
        scoreFinal > melhorScore &&
        scoreFinal >= 50
      ) {
        melhorScore = scoreFinal;
        melhorMatch = {
          itemExame: item.item,
          itemBase: b.item,
          categoria: b.categoria,
          descricaoTecnica: b.descricao_tecnica,
          impacto: b.impacto ?? "",
          setores: (b.setores ?? []).map((s) =>
            s.toLowerCase()
          ),
          scoreConfianca: scoreFinal,
          gravidade: item.gravidade,
        };
      }
    }

    if (melhorMatch) {
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

function agruparPorCategoria(
  matches: MatchClinico[]
): Record<string, MatchClinico[]> {
  const grupos: Record<string, MatchClinico[]> = {};

  for (const m of matches) {
    const cat = m.categoria || "Outros";
    if (!grupos[cat]) grupos[cat] = [];
    grupos[cat].push(m);
  }

  return grupos;
}

function gerarInterpretacao(
  matches: MatchClinico[],
  itensAlterados: ItemAlterado[]
): string {
  if (
    matches.length === 0 &&
    itensAlterados.length === 0
  ) {
    return "Exame dentro dos parâmetros de normalidade. Nenhum desvio significativo identificado.";
  }

  const grupos = agruparPorCategoria(matches);
  const secoes: string[] = [];

  for (const [categoria, itens] of Object.entries(
    grupos
  )) {
    const criticos = itens.filter(
      (i) =>
        i.gravidade === "moderada" ||
        i.gravidade === "critica"
    );
    const leves = itens.filter(
      (i) =>
        i.gravidade === "leve" ||
        i.gravidade === "reducao"
    );

    let texto = `**${categoria}**\n`;

    if (criticos.length > 0) {
      texto += `Alerta: ${criticos
        .map((c) => c.itemBase)
        .join(", ")}. `;
      texto += criticos
        .map(
          (c) => c.impacto || c.descricaoTecnica
        )
        .filter(Boolean)
        .join(" ")
        .trim();
      texto += "\n";
    }

    if (leves.length > 0) {
      texto += `Observar: ${leves
        .map((l) => l.itemBase)
        .join(", ")}. `;
    }

    secoes.push(texto);
  }

  const semMatch = itensAlterados.filter(
    (ia) =>
      !matches.some(
        (m) => m.itemExame === ia.item
      )
  );

  if (semMatch.length > 0) {
    secoes.push(
      `**Itens alterados sem correlação na base clínica**\n${semMatch
        .map(
          (s) =>
            `${s.item} (${s.resultadoOriginal})`
        )
        .join(", ")}.`
    );
  }

  const totalItens = itensAlterados.length;
  const criticos = itensAlterados.filter(
    (i) => i.scoreGravidade >= 3
  ).length;
  const leves = totalItens - criticos;

  const resumo =
    totalItens > 0
      ? `Foram identificados ${totalItens} itens alterados (${criticos} de maior relevância e ${leves} de menor relevância).\n\n`
      : "";

  return resumo + secoes.join("\n\n");
}

// ==============================
// 8. GERADOR DE PONTOS CRÍTICOS
// ==============================

function gerarPontosCriticos(
  matches: MatchClinico[],
  itensAlterados: ItemAlterado[]
): string[] {
  const pontos: string[] = [];

  const comImpacto = matches.filter(
    (m) => m.impacto
  );
  for (const m of comImpacto.slice(0, 8)) {
    pontos.push(`${m.itemBase}: ${m.impacto}`);
  }

  const semMatch = itensAlterados.filter(
    (ia) =>
      !matches.some(
        (m) => m.itemExame === ia.item
      )
  );
  for (const s of semMatch.slice(0, 4)) {
    pontos.push(
      `${s.item} — ${s.resultadoOriginal}`
    );
  }

  return pontos;
}

// ==============================
// 9. SUGESTOR DE TERAPIAS
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
      setoresComPeso.set(
        s,
        (setoresComPeso.get(s) ?? 0) + peso
      );
    }
  }

  const resultados: TerapiaSugerida[] = [];

  for (const terapia of terapias) {
    if (!terapia.ativo) continue;

    const tagsNorm = (terapia.tags ?? []).map((t) =>
      normalizarTexto(t)
    );
    const setoresNorm = (
      terapia.setores_alvo ?? []
    ).map((s) => normalizarTexto(s));

    const alvos = new Set([...tagsNorm, ...setoresNorm]);

    let scoreTotal = 0;
    const motivos: string[] = [];

    for (const [setor, peso] of setoresComPeso.entries()) {
      const setorNorm = normalizarTexto(setor);

      if (alvos.has(setorNorm)) {
        scoreTotal += peso;
        motivos.push(setor);
      }

      for (const alvo of alvos) {
        if (
          alvo.includes(setorNorm) ||
          setorNorm.includes(alvo)
        ) {
          if (!motivos.includes(setor)) {
            scoreTotal += Math.round(peso * 0.7);
            motivos.push(setor);
          }
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

  return resultados
    .sort(
      (a, b) =>
        b.scoreRelevancia - a.scoreRelevancia
    )
    .slice(0, 10);
}

// ==============================
// 10. SCORE GERAL
// ==============================

export function calcularScoreGeral(
  itensAlterados: ItemAlterado[]
): { score: number; status: string } {
  if (itensAlterados.length === 0)
    return { score: 95, status: "Ótimo" };

  let penalidade = 0;

  for (const item of itensAlterados) {
    switch (item.gravidade) {
      case "critica":
        penalidade += 8;
        break;
      case "moderada":
        penalidade += 4;
        break;
      case "leve":
        penalidade += 1.5;
        break;
      case "reducao":
        penalidade += 1;
        break;
    }
  }

  const score = Math.max(
    5,
    Math.round(100 - penalidade)
  );

  let status: string;
  if (score >= 85) status = "Ótimo";
  else if (score >= 70) status = "Bom";
  else if (score >= 50) status = "Atenção";
  else if (score >= 30) status = "Cuidado";
  else status = "Crítico";

  return { score, status };
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
// 🔥 FUNÇÃO PRINCIPAL
// ==============================

export function gerarAnaliseCompleta(
  exame: ExameRow,
  base: BaseAnaliseSaudeRow[],
  terapias: TerapiaRow[]
): AnaliseCompleta {
  const paciente = parsearPaciente(
    exame.nome_paciente
  );

  const itensAlterados = extrairItensAlterados(
    exame.resultado_json
  );

  const matches = buscarMatches(
    itensAlterados,
    base
  );

  const interpretacao = gerarInterpretacao(
    matches,
    itensAlterados
  );

  const pontosCriticos = gerarPontosCriticos(
    matches,
    itensAlterados
  );

  const terapiasSugeridas = sugerirTerapias(
    matches,
    terapias
  );

  const { score: scoreGeral, status: statusScore } =
    calcularScoreGeral(itensAlterados);

  const setoresAfetados = [
    ...new Set(matches.flatMap((m) => m.setores)),
  ];

  const resumoCategorias =
    gerarResumoCategorias(matches);

  return {
    paciente,
    itensAlterados,
    matches,
    interpretacao,
    pontosCriticos,
    terapias: terapiasSugeridas,
    scoreGeral,
    statusScore,
    setoresAfetados,
    resumoCategorias,
  };
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
  evolucao:
    | "melhora"
    | "piora"
    | "novo"
    | "normalizado";
};

export type ComparativoInteligente = {
  melhoraram: ItemComparativo[];
  pioraram: ItemComparativo[];
  novos_problemas: ItemComparativo[];
  normalizados: ItemComparativo[];
};

function classificarStatus(
  resultado: string
): "baixo" | "normal" | "alto" | null {
  const lower = resultado.toLowerCase();
  if (ehNormal(resultado)) return "normal";
  if (lower.includes("redu")) return "baixo";
  if (lower.includes("anormal")) return "alto";
  return null;
}

export function gerarComparativoInteligente(
  exames: ExameRow[]
): ComparativoInteligente {
  const resultado: ComparativoInteligente = {
    melhoraram: [],
    pioraram: [],
    novos_problemas: [],
    normalizados: [],
  };

  if (exames.length < 2) return resultado;

  const anterior = exames[exames.length - 2];
  const atual = exames[exames.length - 1];

  const itensAntes = extrairItensAlterados(
    anterior.resultado_json
  );
  const itensDepois = extrairItensAlterados(
    atual.resultado_json
  );

  const mapaAntes = new Map<string, ItemAlterado>();
  for (const ia of itensAntes) {
    mapaAntes.set(ia.itemNormalizado, ia);
  }

  const mapaDepois = new Map<string, ItemAlterado>();
  for (const id of itensDepois) {
    mapaDepois.set(id.itemNormalizado, id);
  }

  for (const [key, itemAntes] of mapaAntes) {
    if (!mapaDepois.has(key)) {
      resultado.normalizados.push({
        sistema: "Geral",
        item: itemAntes.item,
        antes: "alto",
        depois: "normal",
        valor_antes:
          parseFloat(itemAntes.valor) || undefined,
        evolucao: "normalizado",
      });
    }
  }

  for (const [key, itemDepois] of mapaDepois) {
    const itemAntes = mapaAntes.get(key);

    if (itemAntes) {
      const diff =
        itemDepois.scoreGravidade -
        itemAntes.scoreGravidade;

      const comp: ItemComparativo = {
        sistema: "Geral",
        item: itemDepois.item,
        antes: classificarStatus(
          itemAntes.resultadoOriginal
        ),
        depois: classificarStatus(
          itemDepois.resultadoOriginal
        ),
        valor_antes:
          parseFloat(itemAntes.valor) || undefined,
        valor_depois:
          parseFloat(itemDepois.valor) || undefined,
        variacao: diff,
        evolucao:
          diff < 0
            ? "melhora"
            : diff > 0
              ? "piora"
              : "melhora",
      };

      if (diff < 0) resultado.melhoraram.push(comp);
      else if (diff > 0) resultado.pioraram.push(comp);
    } else {
      resultado.novos_problemas.push({
        sistema: "Geral",
        item: itemDepois.item,
        antes: null,
        depois: classificarStatus(
          itemDepois.resultadoOriginal
        ),
        valor_depois:
          parseFloat(itemDepois.valor) || undefined,
        evolucao: "novo",
      });
    }
  }

  return resultado;
}