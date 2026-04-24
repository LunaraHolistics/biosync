// backend/src/utils/parserBio.ts

export type ItemProcessado = {
  sistema: string;
  item: string;
  valor: number;
  min: number;
  max: number;
  status: "baixo" | "normal" | "alto";
};

function limparHTML(texto: string): string {
  return texto
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extrairNumero(texto: string): number | null {
  const match = texto.match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? parseFloat(match[1]) : null;
}

export function parseBioressonancia(html: string): ItemProcessado[] {
  const resultados: ItemProcessado[] = [];
  const vistos = new Set<string>();
  
  // Extrair linhas da tabela de resultados
  const linhasRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let matchLinha;
  
  while ((matchLinha = linhasRegex.exec(html)) !== null) {
    const linhaHTML = matchLinha[1];
    
    // Extrair células TD
    const celulasRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const celulas: string[] = [];
    let matchCelula;
    
    while ((matchCelula = celulasRegex.exec(linhaHTML)) !== null) {
      celulas.push(limparHTML(matchCelula[1]));
    }
    
    // Validar: precisa de pelo menos 3 células (item, intervalo, valor)
    if (celulas.length < 3) continue;
    
    const item = celulas[0];
    const intervalo = celulas[1];
    const valorStr = celulas[2];
    
    // Ignorar cabeçalhos e descrições
    if (
      !item || 
      item.toLowerCase().includes("item de teste") ||
      item.toLowerCase().includes("padrão de referência") ||
      item.toLowerCase().includes("descrição do parâmetro") ||
      item.toLowerCase().includes("resultados reais") ||
      !intervalo.includes("-") // Precisa ter intervalo "min - max"
    ) {
      continue;
    }
    
    // Extrair min e max do intervalo
    const intervaloMatch = intervalo.match(/([0-9]+(?:\.[0-9]+)?)\s*-\s*([0-9]+(?:\.[0-9]+)?)/);
    if (!intervaloMatch) continue;
    
    const min = parseFloat(intervaloMatch[1]);
    const max = parseFloat(intervaloMatch[2]);
    const valor = extrairNumero(valorStr);
    
    if (valor === null || isNaN(min) || isNaN(max)) continue;
    
    // Determinar status
    let status: "baixo" | "normal" | "alto" = "normal";
    if (valor < min) status = "baixo";
    else if (valor > max) status = "alto";
    
    // Evitar duplicatas
    const chave = `${item}::${valor}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    
    resultados.push({
      sistema: "Geral",
      item,
      valor,
      min,
      max,
      status
    });
  }
  
  console.log(`✅ Parser: ${resultados.length} itens extraídos`);
  if (resultados.length > 0) {
    console.log("📋 Amostra:", resultados.slice(0, 3).map(r => ({ item: r.item, valor: r.valor })));
  }
  
  return resultados;
}