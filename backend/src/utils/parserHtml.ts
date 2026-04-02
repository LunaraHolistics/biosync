import { load } from "cheerio";

export interface BioItem {
  nome: string;
  valor: number;
}

export function parseHtmlBioressonancia(html: string): BioItem[] {
  const $ = load(html);

  let resultados: BioItem[] = [];

  // 1️⃣ EXTRAÇÃO DE TABELAS
  $("table").each((_, table) => {
    $(table)
      .find("tr")
      .each((_, row) => {
        const cells = $(row).find("td");

        if (cells.length >= 2) {
          const nome = normalizeText($(cells[0]).text());
          const valor = extractNumber($(cells[1]).text());

          if (isValid(nome, valor)) {
            resultados.push({ nome, valor });
          }
        }
      });
  });

  // 2️⃣ FALLBACK: DIVS / LINHAS SOLTAS
  if (resultados.length === 0) {
    $("body *").each((_, el) => {
      const text = normalizeText($(el).text());

      const match = tryParseLine(text);
      if (match) resultados.push(match);
    });
  }

  // 3️⃣ FALLBACK FINAL: TEXTO BRUTO
  if (resultados.length === 0) {
    const text = normalizeText($.text());

    text.split("\n").forEach((line) => {
      const match = tryParseLine(line);
      if (match) resultados.push(match);
    });
  }

  // 4️⃣ Remover duplicados
  const unique = deduplicate(resultados);

  return unique;
}

//
// 🧩 HELPERS
//

function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\u00A0/g, " ")
    .trim();
}

function extractNumber(text: string): number | null {
  if (!text) return null;

  // pega número com vírgula ou ponto
  const match = text.match(/-?\d+[.,]?\d*/);

  if (!match) return null;

  const num = match[0].replace(",", ".");
  return parseFloat(num);
}

function isValid(nome: string, valor: number | null): valor is number {
  if (!nome || valor === null) return false;

  const invalidLabels = [
    "item",
    "resultado",
    "valor",
    "score",
    "análise",
  ];

  if (invalidLabels.some((label) =>
    nome.toLowerCase().includes(label)
  )) {
    return false;
  }

  return true;
}

function tryParseLine(text: string): BioItem | null {
  if (!text) return null;

  // tenta separar texto + número
  const match = text.match(/^(.+?)\s*(-?\d+[.,]?\d*)$/);

  if (!match) return null;

  const nome = normalizeText(match[1]);
  const valor = extractNumber(match[2]);

  if (!isValid(nome, valor)) return null;

  return { nome, valor };
}

function deduplicate(items: BioItem[]): BioItem[] {
  const map = new Map<string, BioItem>();

  for (const item of items) {
    const key = item.nome.toLowerCase();

    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
}