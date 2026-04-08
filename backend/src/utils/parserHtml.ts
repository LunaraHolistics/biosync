import * as cheerio from "cheerio";
import { AnyNode } from "domhandler";

export interface ResultadoItem {
  item: string;
  intervalo: string;
  valor: string;
  resultado: string;
}

export interface CategoriaAnalise {
  categoria: string;
  resultados: ResultadoItem[];
}

export interface ParsedHtmData {
  nome: string;
  sexo: string;
  idade: string;
  data_teste: string;
  protocolo: string;
  analises: CategoriaAnalise[];
}

function limpar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

function extrairCampo(texto: string, label: string): string {
  const regex = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n]+)`, "i");
  return (texto.match(regex) || [])[1]?.trim() || "";
}

export function parseHtmReport(buffer: Buffer): ParsedHtmData {
  const decoder = new TextDecoder("iso-8859-1");
  const htmlString = decoder.decode(buffer);

  const $ = cheerio.load(htmlString);

  const text = limpar($("body").text());

  const nome = extrairCampo(text, "Nome");
  const sexo = extrairCampo(text, "Sexo");
  const idade = extrairCampo(text, "Idade");
  const dataStr = extrairCampo(text, "Período do teste");

  const protocolo = dataStr
    ? `HTM-${dataStr.replace(/[\s/:]/g, "")}`
    : "N/A";

  const analises: CategoriaAnalise[] = [];

  $("table").each((_i: number, el: AnyNode) => {
    const tableText = $(el).text();

    if (!tableText.includes("Item de Teste")) return;

    // 🔥 DETECÇÃO DE CATEGORIA MAIS INTELIGENTE
    let categoriaNome = "Análise Geral";

    const possivelTitulo = $(el)
      .prevAll()
      .filter((_, e) => {
        const t = limpar($(e).text());
        return t.length > 3 && t.length < 80;
      })
      .first();

    if (possivelTitulo.length) {
      categoriaNome = limpar(possivelTitulo.text());
    }

    const resultados: ResultadoItem[] = [];

    $(el)
      .find("tr")
      .each((_j: number, row: AnyNode) => {
        const cells = $(row).find("td");

        // 🔥 FLEXÍVEL: aceita 4 ou mais colunas
        if (cells.length >= 4) {
          const itemNome = limpar($(cells[0]).text());

          if (!itemNome || itemNome.toLowerCase().includes("item de teste"))
            return;

          resultados.push({
            item: itemNome,
            intervalo: limpar($(cells[1]).text()),
            valor: limpar($(cells[2]).text()),
            resultado: limpar($(cells[3]).text()),
          });
        }
      });

    if (resultados.length > 0) {
      analises.push({
        categoria: categoriaNome,
        resultados,
      });
    }
  });

  return {
    nome,
    sexo,
    idade,
    data_teste: dataStr,
    protocolo,
    analises,
  };
}