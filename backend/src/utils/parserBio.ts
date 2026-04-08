export type ItemProcessado = {
  sistema: string;
  item: string;
  valor: number;
  min: number;
  max: number;
  status: "baixo" | "normal" | "alto";
};

function limparTexto(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

function detectarSistema(linha: string): string | null {
  if (!linha) return null;

  const limpa = limparTexto(linha);

  // evita linhas que claramente são dados numéricos
  if (/[0-9]+\s*-\s*[0-9]+/.test(limpa)) return null;

  // evita linhas muito longas (provável descrição)
  if (limpa.length > 80) return null;

  return limpa.replace(/[()]/g, "");
}

export function parseBioressonancia(texto: string): ItemProcessado[] {
  const linhas = texto
    .split("\n")
    .map((l) => limparTexto(l))
    .filter((l) => l.length > 0);

  const resultados: ItemProcessado[] = [];
  const vistos = new Set<string>();

  let sistemaAtual = "Geral";

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];

    // 🔥 DETECÇÃO DE SISTEMA MELHORADA
    if (
      linha.includes("Cartão do Relatório") ||
      linha.includes("Relatório de Análise")
    ) {
      const candidato = detectarSistema(linhas[i - 1]);
      if (candidato) {
        sistemaAtual = candidato;
      }
      continue;
    }

    const combinado = [
      linha,
      linhas[i + 1] || "",
      linhas[i + 2] || "",
    ].join(" ");

    // 🔥 REGEX MAIS FLEXÍVEL
    const match = combinado.match(
      /(.+?)\s+([0-9]+(?:\.[0-9]+)?)\s*-\s*([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)/,
    );

    if (!match) continue;

    const item = limparTexto(match[1]);
    const min = parseFloat(match[2]);
    const max = parseFloat(match[3]);
    const valor = parseFloat(match[4]);

    if (
      !item ||
      Number.isNaN(valor) ||
      Number.isNaN(min) ||
      Number.isNaN(max)
    ) {
      continue;
    }

    // 🔥 EVITA DUPLICAÇÃO
    const chave = `${sistemaAtual}::${item}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    let status: "baixo" | "normal" | "alto" = "normal";

    if (valor < min) status = "baixo";
    else if (valor > max) status = "alto";

    resultados.push({
      sistema: sistemaAtual,
      item,
      valor,
      min,
      max,
      status,
    });
  }

  return resultados;
}