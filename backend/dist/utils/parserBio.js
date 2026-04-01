import * as cheerio from "cheerio";

export type ItemProcessado = {
  sistema: string;
  item: string;
  valor: number;
  min: number;
  max: number;
  status: "baixo" | "normal" | "alto";
};

export function parseBioressonancia(input: string) {
  // 🔥 Detecta se é HTML
  const isHtml = input.includes("<table") || input.includes("<tr");

  if (isHtml) {
    return parseHtml(input);
  }

  return parseTexto(input);
}

/**
 * 🔥 NOVO: Parser de HTML (tabelas)
 */
function parseHtml(html: string): ItemProcessado[] {
  const $ = cheerio.load(html);

  const resultados: ItemProcessado[] = [];

  let sistemaAtual = "Geral";

  $("tr").each((_, row) => {
    const cols = $(row)
      .find("td, th")
      .map((_, el) => $(el).text().trim())
      .get();

    if (cols.length === 0) return;

    // 🔥 Detecta sistema (linha com 1 coluna)
    if (cols.length === 1 && cols[0].length < 50) {
      sistemaAtual = cols[0];
      return;
    }

    // 🔥 Espera padrão:
    // ITEM | MIN-MAX | VALOR
    if (cols.length >= 3) {
      const item = cols[0];

      const rangeMatch = cols[1].match(/([0-9.]+)\s*-\s*([0-9.]+)/);
      const valor = parseFloat(cols[2]);

      if (!rangeMatch || isNaN(valor)) return;

      const min = parseFloat(rangeMatch[1]);
      const max = parseFloat(rangeMatch[2]);

      let status: "baixo" | "normal" | "alto" = "normal";

      if (valor < min) status = "baixo";
      if (valor > max) status = "alto";

      resultados.push({
        sistema: sistemaAtual,
        item,
        valor,
        min,
        max,
        status,
      });
    }
  });

  console.log("Itens extraídos (HTML):", resultados.length);

  return resultados;
}

/**
 * 🔹 Parser antigo (fallback)
 */
function parseTexto(texto: string): ItemProcessado[] {
  const linhas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const resultados: ItemProcessado[] = [];

  let sistemaAtual = "Geral";

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];

    if (
      linha.includes("Cartão do Relatório") ||
      linha.includes("Relatório de Análise")
    ) {
      const prev = linhas[i - 1];
      if (prev && prev.length < 60) {
        sistemaAtual = prev.replace(/[()]/g, "").trim();
      }
      continue;
    }

    const combinado = [
      linha,
      linhas[i + 1] || "",
      linhas[i + 2] || "",
    ].join(" ");

    const match = combinado.match(
      /(.+?)\s+([0-9.]+)\s*-\s*([0-9.]+)\s+([0-9.]+)/
    );

    if (match) {
      const item = match[1].replace(/\s+/g, " ").trim();
      const min = parseFloat(match[2]);
      const max = parseFloat(match[3]);
      const valor = parseFloat(match[4]);

      if (isNaN(valor) || isNaN(min) || isNaN(max)) continue;

      let status: "baixo" | "normal" | "alto" = "normal";
      if (valor < min) status = "baixo";
      if (valor > max) status = "alto";

      resultados.push({
        sistema: sistemaAtual,
        item,
        valor,
        min,
        max,
        status,
      });
    }
  }

  console.log("Itens extraídos (texto):", resultados.length);

  return resultados;
}