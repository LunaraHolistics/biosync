import * as cheerio from 'cheerio';
import { AnyNode } from 'domhandler';

export interface ParsedHtmData {
  nome: string;
  sexo: string;
  idade: string;
  data_teste: string;
  protocolo: string; // Gerado automaticamente, pois o HTML não tem
  analises: {
    categoria: string;
    resultados: {
      item: string;
      intervalo: string;
      valor: string;
      resultado: string;
    }[];
  }[];
}

export function parseHtmReport(buffer: Buffer): ParsedHtmData {
  // 1. CORREÇÃO VITAL: O HTML vem em iso-8859-1. Precisamos converter para UTF-8
  // para não dar erro nos acentos (ã, ç, é).
  const decoder = new TextDecoder('iso-8859-1');
  const htmlString = decoder.decode(buffer);
  
  const $ = cheerio.load(htmlString);
  
  // 2. Extrair dados do paciente (usando Regex no texto geral é mais seguro aqui)
  const text = $('body').text();
  const nome = (text.match(/Nome:\s*([^\n<]+)/i) || [])[1]?.trim() || '';
  const sexo = (text.match(/Sexo:\s*([^\n<]+)/i) || [])[1]?.trim() || '';
  const idade = (text.match(/Idade:\s*([^\n<]+)/i) || [])[1]?.trim() || '';
  const dataStr = (text.match(/Período do teste:\s*([^\n<]+)/i) || [])[1]?.trim() || '';
  
  // Gera um protocolo baseado na data, já que o HTML não tem protocolo real
  const protocolo = dataStr ? `HTM-${dataStr.replace(/[\s/:]/g, '')}` : 'N/A';

  const analises: ParsedHtmData['analises'] = [];

  // 3. Procurar as tabelas de resultados (Elas têm a classe "table")
  $('table.table').each((_i: number, el: AnyNode) => {
    const tableText = $(el).text();
    
    // Verifica se é a tabela de resultados mesmo (tem "Item de Teste" no cabeçalho)
    if (!tableText.includes('Item de Teste')) return;

    // Acha o título da categoria (está na tag <font size="6"> antes da tabela)
    let categoriaNome = 'Análise Geral';
    const prevFont = $(el).prevAll('font[size="6"]').first();
    if (prevFont.length) {
      categoriaNome = prevFont.text().trim();
    } else {
      const parentFont = $(el).parent().prevAll().find('font[size="6"]').first();
      if (parentFont.length) categoriaNome = parentFont.text().trim();
    }

    const resultados = [];

    // 4. Extrai as linhas da tabela
    $(el).find('tr').each((_j: number, row: AnyNode) => {
      const cells = $(row).find('td');
      
      // As linhas de dados têm exatamente 4 colunas (TDs)
      if (cells.length === 4) {
        const itemNome = $(cells[0]).text().trim();
        
        // Pula o cabeçalho
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
