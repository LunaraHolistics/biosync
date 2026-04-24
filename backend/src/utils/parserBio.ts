// backend/src/utils/parserBio.ts

import * as cheerio from 'cheerio';

export interface ItemBio {
  item: string;
  valor: number;
  status: 'baixo' | 'normal' | 'alto' | 'desconhecido';
  sistema?: string;
  min?: number;
  max?: number;
}

/**
 * Detecta status baseado no valor e na faixa de referência
 */
function detectarStatus(valor: number, referencia: string): ItemBio['status'] {
  // Tenta extrair min-max da referência (ex: "1.219 - 3.021")
  const match = referencia.match(/([\d.]+)\s*[-–—]\s*([\d.]+)/);
  if (!match) return 'desconhecido';

  const min = parseFloat(match[1]);
  const max = parseFloat(match[2]);

  if (isNaN(min) || isNaN(max)) return 'desconhecido';
  if (valor < min) return 'baixo';
  if (valor > max) return 'alto';
  return 'normal';
}

/**
 * Detecta sistema/categoria baseado no nome do item
 */
function detectarSistema(nome: string): string {
  const n = nome.toLowerCase();
  if (/(cálcio|magnésio|zinco|ferro|potássio|selênio|fósforo|cobre|cobalto|manganês|iodo|níquel|flúor|molibdênio|vanádio|estanho|silício|estrôncio|boro)/i.test(n)) {
    return 'minerais';
  }
  if (/vitamina/i.test(n)) return 'vitaminas';
  if (/hormônio|hormonal|tireóide|tireoide|insulina/i.test(n)) return 'hormonal';
  if (/sono|melatonina|cortisol|adrenalina/i.test(n)) return 'sono_estresse';
  return 'geral';
}

/**
 * Parser robusto usando Cheerio para extrair dados de tabelas HTML
 */
export function parseBioressonancia(html: string): ItemBio[] {
  if (!html || typeof html !== 'string') {
    console.error('❌ Parser: HTML inválido ou vazio');
    return [];
  }

  const $ = cheerio.load(html);
  const resultados: ItemBio[] = [];

  // Itera sobre cada linha da tabela
  $('tr').each((_, row) => {
    const cols = $(row).find('td');
    
    // Precisa de pelo menos 3 colunas: nome, referência, valor
    if (cols.length < 3) return;

    // Extrai texto limpo de cada célula
    const nome = $(cols[0]).text().trim();
    const referencia = $(cols[1]).text().trim();
    const valorRaw = $(cols[2]).text().trim();

    // Converte valor para número (aceita vírgula como decimal)
    const valor = parseFloat(valorRaw.replace(',', '.'));

    // Valida: nome não pode estar vazio e valor deve ser número válido
    if (!nome || isNaN(valor) || nome.length > 100) return;

    // Ignora cabeçalhos e linhas de legenda
    if (/item de teste|padrão de referência|descrição do parâmetro/i.test(nome)) {
      return;
    }

    resultados.push({
      item: nome,
      valor,
      status: detectarStatus(valor, referencia),
      sistema: detectarSistema(nome),
      min: parseFloat(referencia.match(/([\d.]+)\s*[-–—]/)?.[1] || '0'),
      max: parseFloat(referencia.match(/[-–—]\s*([\d.]+)/)?.[1] || '0')
    });
  });

  console.log(`✅ Parser: ${resultados.length} itens extraídos com Cheerio`);
  return resultados;
}

/**
 * Fallback emergencial (caso Cheerio falhe) - usa regex melhorado
 * NÃO use como solução principal, apenas para debug
 */
export function parseBioressonanciaFallback(html: string): ItemBio[] {
  const resultados: ItemBio[] = [];
  
  // Regex que captura TRs incluindo quebras de linha
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const linhaHtml = trMatch[1];
    const celulas: string[] = [];
    
    // Extrai TDs dentro do TR
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    
    while ((tdMatch = tdRegex.exec(linhaHtml)) !== null) {
      const conteudo = tdMatch[1]
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .trim();
      celulas.push(conteudo);
    }
    
    if (celulas.length >= 3) {
      const nome = celulas[0];
      const referencia = celulas[1];
      const valorRaw = celulas[2];
      const valor = parseFloat(valorRaw.replace(',', '.'));
      
      if (nome && !isNaN(valor) && nome.length < 100) {
        if (!/item de teste|padrão de referência/i.test(nome)) {
          resultados.push({
            item: nome,
            valor,
            status: detectarStatus(valor, referencia),
            sistema: detectarSistema(nome)
          });
        }
      }
    }
  }
  
  return resultados;
}