// backend/src/utils/parserBio.ts

import * as cheerio from 'cheerio';

// ✅ IMPORTAR O TIPO DA ENGINE para garantir compatibilidade
// Ajuste o caminho conforme sua estrutura de pastas
import type { ItemProcessado } from '../types';

// ✅ ALIAS: ItemBio é exatamente ItemProcessado (sem divergências)
export type ItemBio = ItemProcessado;

/**
 * Detecta status baseado no valor e na faixa de referência
 */
function detectarStatus(valor: number, referencia: string): ItemBio['status'] {
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
 * Sempre retorna string (nunca undefined)
 */
function detectarSistema(nome: string): string {
  const n = nome.toLowerCase();
  if (/(cálcio|magnésio|zinco|ferro|potássio|selênio|fósforo|cobre|cobalto|manganês|iodo|níquel|flúor|molibdênio|vanádio|estanho|silício|estrôncio|boro)/i.test(n)) {
    return 'minerais';
  }
  if (/vitamina/i.test(n)) return 'vitaminas';
  if (/hormônio|hormonal|tireóide|tireoide|insulina/i.test(n)) return 'hormonal';
  if (/sono|melatonina|cortisol|adrenalina/i.test(n)) return 'sono_estresse';
  return 'geral'; // ← Sempre retorna algo
}

/**
 * Parser robusto usando Cheerio para extrair dados de tabelas HTML
 * Retorna ItemProcessado[] para compatibilidade direta com a engine
 */
export function parseBioressonancia(html: string): ItemProcessado[] {
  if (!html || typeof html !== 'string') {
    console.error('❌ Parser: HTML inválido ou vazio');
    return [];
  }

  const $ = cheerio.load(html);
  const resultados: ItemProcessado[] = [];

  $('tr').each((_, row) => {
    const cols = $(row).find('td');
    if (cols.length < 3) return;

    const nome = $(cols[0]).text().trim();
    const referencia = $(cols[1]).text().trim();
    const valorRaw = $(cols[2]).text().trim();
    const valor = parseFloat(valorRaw.replace(',', '.'));

    if (!nome || isNaN(valor) || nome.length > 100) return;
    if (/item de teste|padrão de referência|descrição do parâmetro/i.test(nome)) return;

    // Extrair min/max com fallback para 0 (garante número, nunca undefined)
    const minMatch = referencia.match(/([\d.]+)\s*[-–—]/);
    const maxMatch = referencia.match(/[-–—]\s*([\d.]+)/);
    const min = minMatch ? parseFloat(minMatch[1]) : 0;
    const max = maxMatch ? parseFloat(maxMatch[1]) : 0;

    // Determinar status
    let status: ItemProcessado['status'] = 'normal';
    if (valor < min) status = 'baixo';
    else if (valor > max) status = 'alto';

    resultados.push({
      item: nome,
      valor,
      min,      // ← Sempre número (obrigatório)
      max,      // ← Sempre número (obrigatório)
      status,
      sistema: detectarSistema(nome)  // ← Sempre string (obrigatório)
    });
  });

  console.log(`✅ Parser: ${resultados.length} itens extraídos com Cheerio`);
  return resultados;
}

/**
 * Fallback emergencial (caso Cheerio falhe) - usa regex melhorado
 * Também retorna ItemProcessado[] para compatibilidade
 */
export function parseBioressonanciaFallback(html: string): ItemProcessado[] {
  const resultados: ItemProcessado[] = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const linhaHtml = trMatch[1];
    const celulas: string[] = [];
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
          const minMatch = referencia.match(/([\d.]+)\s*[-–—]/);
          const maxMatch = referencia.match(/[-–—]\s*([\d.]+)/);
          
          let status: ItemProcessado['status'] = 'normal';
          const min = minMatch ? parseFloat(minMatch[1]) : 0;
          const max = maxMatch ? parseFloat(maxMatch[1]) : 0;
          if (valor < min) status = 'baixo';
          else if (valor > max) status = 'alto';

          resultados.push({
            item: nome,
            valor,
            min,
            max,
            status,
            sistema: detectarSistema(nome)
          });
        }
      }
    }
  }

  return resultados;
}