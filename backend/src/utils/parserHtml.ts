import * as cheerio from 'cheerio';
import { AnyNode } from 'domhandler';

// 1. Criação de interfaces explícitas para garantir a tipagem correta em todos os escopos
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

export function parseHtmReport(buffer: Buffer): ParsedHtmData {
  const decoder = new TextDecoder('iso-8859-1');
  const htmlString = decoder.decode(buffer);
  
  const $ = cheerio.load(htmlString);
  
  const text = $('body').text();
  const nome = (text.match(/Nome:\s*([^\n<]+)/i) || [])[1]?.trim() || '';
  const sexo = (text.match(/Sexo:\s*([^\n<]+)/i) || [])[1]?.trim() || '';
  const idade = (text.match(/Idade:\s*([^\n<]+)/i) || [])[1]?.trim() || '';
  const dataStr = (text.match(/Período do teste:\s*([^\n<]+)/i) || [])[1]?.trim() || '';
  
  const protocolo = dataStr ? `HTM-${dataStr.replace(/[\s/:]/g, '')}` : 'N/A';

  // 2. Tipagem explícita usando a interface
  const analises: CategoriaAnalise[] = [];

  $('table.table').each((_i: number, el: AnyNode) => {
    const tableText = $(el).text();
    
    if (!tableText.includes('Item de Teste')) return;

    let categoriaNome = 'Análise Geral';
    const prevFont = $(el).prevAll('font[size="6"]').first();
    if (prevFont.length) {
      categoriaNome = prevFont.text().trim();
    } else {
      const parentFont = $(el).parent().prevAll().find('font[size="6"]').first();
      if (parentFont.length) categoriaNome = parentFont.text().trim();
    }

    // 3. O array agora é instanciado com a interface ResultadoItem[], resolvendo os erros TS7034 e TS7005
    const resultados: ResultadoItem[] = [];

    $(el).find('tr').each((_j: number, row: AnyNode) => {
      const cells = $(row).find('td');
      
      if (cells.length === 4) {
        const itemNome = $(cells[0]).text().trim();
        
        if (itemNome === 'Item de Teste') return;

        resultados.push({
          item: itemNome,
          intervalo: $(cells[1]).text().trim(),
          valor: $(cells[2]).text().trim(),
          resultado: $(cells[3]).text().trim(),
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
