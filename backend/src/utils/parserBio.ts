export type ItemProcessado = {
  sistema: string;
  item: string;
  valor: number;
  min: number;
  max: number;
  status: "baixo" | "normal" | "alto";
};

function limparTexto(texto: string): string {
  return texto
    .replace(/<[^>]*>/g, "") // Remove tags HTML
    .replace(/\s+/g, " ")
    .trim();
}

function extrairValorNumerico(texto: string): number | null {
  const match = texto.match(/([0-9]+(?:\.[0-9]+)?)/);
  return match ? parseFloat(match[1]) : null;
}

function detectarSistema(linha: string): string | null {
  if (!linha) return null;
  
  const limpa = limparTexto(linha);
  
  // Evita linhas que são dados numéricos
  if (/[0-9]+\s*-\s*[0-9]+/.test(limpa)) return null;
  
  // Evita linhas muito longas (descrições)
  if (limpa.length > 80) return null;
  
  // Evita tags HTML
  if (limpa.startsWith("<")) return null;
  
  return limpa.replace(/[()]/g, "");
}

export function parseBioressonancia(texto: string): ItemProcessado[] {
  const resultados: ItemProcessado[] = [];
  const vistos = new Set<string>();
  
  let sistemaAtual = "Geral";
  
  // 🔥 EXTRAI TODAS AS TABELAS DO HTML
  const tabelaRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
  const tabelas = texto.match(tabelaRegex) || [];
  
  for (const tabela of tabelas) {
    // 🔥 EXTRAI LINHAS (TR) DA TABELA
    const linhaRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const linhas = tabela.match(linhaRegex) || [];
    
    for (const linha of linhas) {
      // 🔥 EXTRAI CÉLULAS (TD) DA LINHA
      const celulaRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      const celulas: string[] = [];
      let match;
      
      while ((match = celulaRegex.exec(linha)) !== null) {
        celulas.push(limparTexto(match[1]));
      }
      
      // 🔥 PADRÃO ESPERADO: [Item] [Min - Max] [Valor] [Status]
      // Exemplo: Cálcio | 1.219 - 3.021 | 0.975 | Ligeiramente Anormal(+)
      
      if (celulas.length >= 3) {
        const item = celulas[0];
        const intervalo = celulas[1];
        const valorStr = celulas[2];
        const statusStr = celulas[3] || "";
        
        // Extrai min e max do intervalo (ex: "1.219 - 3.021")
        const intervaloMatch = intervalo.match(/([0-9]+(?:\.[0-9]+)?)\s*-\s*([0-9]+(?:\.[0-9]+)?)/);
        
        if (!intervaloMatch) continue;
        
        const min = parseFloat(intervaloMatch[1]);
        const max = parseFloat(intervaloMatch[2]);
        const valor = extrairValorNumerico(valorStr);
        
        if (!item || valor === null || Number.isNaN(min) || Number.isNaN(max)) {
          continue;
        }
        
        // Evita duplicação
        const chave = `${sistemaAtual}::${item}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        
        // Determina status
        let status: "baixo" | "normal" | "alto" = "normal";
        
        if (valor < min) status = "baixo";
        else if (valor > max) status = "alto";
        
        // Verifica se é uma linha de cabeçalho ou sistema
        if (item.toLowerCase().includes("item de teste") || 
            item.toLowerCase().includes("padrão de referência") ||
            item.toLowerCase().includes("descrição")) {
          continue;
        }
        
        resultados.push({
          sistema: sistemaAtual,
          item,
          valor,
          min,
          max,
          status,
        });
      }
      
      // 🔥 DETECTA MUDANÇA DE SISTEMA
      const sistemaDetectado = detectarSistema(linha);
      if (sistemaDetectado && !sistemaDetectado.includes("TABLE")) {
        sistemaAtual = sistemaDetectado;
      }
    }
  }
  
  console.log(`✅ Parser extraiu ${resultados.length} itens`);
  if (resultados.length > 0) {
    console.log("📋 Primeiros itens:", resultados.slice(0, 3));
  }
  
  return resultados;
}