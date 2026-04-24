// src/utils/mapper.ts
import { ItemParser, MarcadorBio } from '../types';

export function mapParserToEngine(items: ItemParser[]): MarcadorBio[] {
  return items.map(item => {
    // Normalizar valor para percentual 0-100
    const valorNum = typeof item.valor === 'string' 
      ? parseFloat(item.valor.replace(',', '.')) 
      : item.valor;
    
    let percentual = 50; // fallback neutro
    if (!isNaN(valorNum)) {
      if (valorNum >= 1.0 && valorNum <= 3.0) {
        percentual = 75 + ((valorNum - 1) / 2) * 25; // faixa ideal
      } else if (valorNum > 0 && valorNum < 1.0) {
        percentual = 20 + (valorNum * 55); // abaixo do ideal
      } else {
        percentual = Math.max(15, 100 - (Math.log10(valorNum + 1) * 20)); // acima
      }
    } else if (String(item.valor).includes('%')) {
      percentual = parseFloat(String(item.valor)) || 50;
    }

    return {
      nome: item.item,
      percentual: Math.min(100, Math.max(0, Math.round(percentual))),
      categoria: item.categoria || item.sistema || 'Geral', // ← Resolve TS2339
      sistema: item.sistema,
      status: item.status
    };
  });
}