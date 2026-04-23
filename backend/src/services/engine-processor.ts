// 📦 engine-processor.ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export interface RawDeviceItem {
  nome: string;
  percentual?: number; // 0-100 (100 = ideal, 0 = crítico)
  categoria?: string;
}

export interface ProcessedAnalysis {
  modo_selecionado: string;
  category_scores: Record<string, number>;
  critical_alerts: Array<{ item: string; score: number; impact: string }>;
  quick_wins: Array<{ item: string; action: string; expected: string }>;
  imc_value: number | null;
  imc_status: string | null;
  translated_items: Array<{ raw: string; client_term: string; trainer_term: string }>;
  suggested_protocol: { therapies: string[]; checklist: string[]; timeline: string };
}

export async function processBioSyncData(
  rawItems: RawDeviceItem[],
  selectedMode: 'fitness' | 'weight_loss' | 'emotional_sleep' | 'immunity' | 'mental',
  clientWeight?: number,
  clientHeightMeters?: number
): Promise<ProcessedAnalysis> {
  
  // 1️⃣ CARREGAR REFERÊNCIAS DO BANCO
  console.log("📥 Carregando referências do Supabase...");
  const { data: correlations, error: errCorr } = await supabase.from('correlacoes_marcadores').select('*');
  const { data: protocols, error: errProt } = await supabase.from('protocolos_base').select('*');
  const { data: terms, error: errTerms } = await supabase.from('base_analise_saude').select('item, client_friendly_term, trainer_friendly_term, mode_tags');

  // 🔍 DEBUG: Verificar erros no carregamento
  if (errCorr) console.error("❌ Erro ao carregar correlacoes_marcadores:", errCorr);
  if (errProt) console.error("❌ Erro ao carregar protocolos_base:", errProt);
  if (errTerms) console.error("❌ Erro ao carregar base_analise_saude:", errTerms);

  console.log("🗺️ Tamanho dos mapas carregados:");
  console.log("- correlacoes_marcadores:", correlations?.length || 0);
  console.log("- protocolos_base:", protocols?.length || 0);
  console.log("- base_analise_saude:", terms?.length || 0);

  const correlationMap = new Map(correlations?.map(c => [c.marcador_nome.toLowerCase().trim(), c]) || []);
  const termMap = new Map(terms?.map(t => [t.item.toLowerCase().trim(), t]) || []);

  console.log("📊 Mapas criados - correlationMap size:", correlationMap.size);
  console.log("📊 Mapas criados - termMap size:", termMap.size);

  // 2️⃣ FILTRAR E TRADUZIR ITENS
  console.log(`\n🔍 Processando ${rawItems.length} itens do dispositivo...`);
  
  const processedItems = rawItems.map(item => {
    const key = item.nome.toLowerCase().trim();
    const corr = correlationMap.get(key);
    const term = termMap.get(key);

    // 🔍 DEBUG: Log para os primeiros 10 itens
    if (rawItems.indexOf(item) < 10) {
      console.log(`\n📝 Item "${item.nome}" (key: "${key}"):`);
      console.log(`   - correlationMap.has("${key}"): ${correlationMap.has(key)}`);
      console.log(`   - termMap.has("${key}"): ${termMap.has(key)}`);
      console.log(`   - corr encontrado: ${!!corr}`);
      console.log(`   - term encontrado: ${!!term}`);
    }
    
    return {
      raw: item.nome,
      client_term: term?.client_friendly_term || item.nome,
      trainer_term: term?.trainer_friendly_term || '',
      score: item.percentual ?? 50,
      impacts: corr ? {
        fitness: corr.afeta_desempenho_fisico,
        sleep: corr.afeta_sono,
        metabolism: corr.afeta_metabolismo,
        emotional: corr.afeta_emocional,
        description: corr.descricao_impacto
      } : null
    };
  });

  // 3️⃣ ROTEAMENTO POR MODO (Prioriza itens que afetam o modo escolhido)
  const modeWeights: Record<string, string[]> = {
    fitness: ['fitness', 'immunity'],
    weight_loss: ['metabolism', 'emotional'],
    emotional_sleep: ['sleep', 'emotional'],
    immunity: ['immunity', 'fitness'],
    mental: ['emotional', 'sleep']
  };

  const activeTags = modeWeights[selectedMode] || ['geral'];
  const relevantItems = processedItems.filter(item => 
    item.impacts && activeTags.some(tag => 
      (tag === 'fitness' && item.impacts.fitness) ||
      (tag === 'sleep' && item.impacts.sleep) ||
      (tag === 'metabolism' && item.impacts.metabolism) ||
      (tag === 'emotional' && item.impacts.emotional) ||
      (tag === 'immunity' && item.impacts.fitness) // imunidade ligada a recuperação
    )
  );

  // 4️⃣ CÁLCULO DE SCORES POR CATEGORIA (Média ponderada inversa: 100 - média dos desequilíbrios)
  const calculateScore = (items: typeof processedItems) => {
    if (items.length === 0) return 75; // Neutro
    const avgDesequilibrio = items.reduce((acc, curr) => acc + (100 - curr.score), 0) / items.length;
    return Math.max(0, Math.min(100, Math.round(100 - avgDesequilibrio)));
  };

  const category_scores = {
    fitness: calculateScore(relevantItems.filter(i => i.impacts?.fitness)),
    emotional: calculateScore(relevantItems.filter(i => i.impacts?.emotional)),
    sono: calculateScore(relevantItems.filter(i => i.impacts?.sleep)),
    imunidade: calculateScore(relevantItems.filter(i => i.impacts.fitness || i.impacts.metabolism)),
    mental: calculateScore(relevantItems.filter(i => i.impacts.emotional || i.impacts.sleep))
  };

  // 5️⃣ IDENTIFICAR TOP 3 CRÍTICOS (Menores scores + maior impacto)
  const critical_alerts = relevantItems
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(item => ({
      item: item.client_term,
      score: item.score,
      impact: item.impacts?.description || 'Desequilíbrio bioenergético identificado'
    }));

  // 6️⃣ QUICK WINS (Itens com score < 45 mas de fácil correção terapêutica)
  const quick_wins = relevantItems
    .filter(i => i.score < 45 && i.impacts?.description?.includes('suplemento') || i.impacts?.description?.includes('respiração'))
    .slice(0, 3)
    .map(item => ({
      item: item.client_term,
      action: `Focar em ${item.client_term} com protocolo específico`,
      expected: 'Melhora perceptível em 7-14 dias'
    }));

  // 7️⃣ MATCH COM PROTOCOLOS
  const matchedProtocol = protocols?.find(p => 
    p.condition_key.includes(critical_alerts[0]?.item.toLowerCase().split('(')[0].trim() || 'general')
  ) || protocols[0]; // Fallback para o primeiro protocolo

  // 8️⃣ CÁLCULO IMC
  let imc_value = null;
  let imc_status = null;
  if (clientWeight && clientHeightMeters) {
    imc_value = Math.round((clientWeight / (clientHeightMeters ** 2)) * 10) / 10;
    imc_status = imc_value < 18.5 ? 'Abaixo do peso' : 
                 imc_value < 24.9 ? 'Normal' : 
                 imc_value < 29.9 ? 'Sobrepeso' : 'Obesidade';
  }

  return {
    modo_selecionado: selectedMode,
    category_scores,
    critical_alerts,
    quick_wins,
    imc_value,
    imc_status,
    translated_items: processedItems.map(i => ({ raw: i.raw, client_term: i.client_term, trainer_term: i.trainer_term })),
    suggested_protocol: {
      therapies: matchedProtocol?.therapy_suggestions || [],
      checklist: matchedProtocol?.action_checklist || [],
      timeline: matchedProtocol?.expected_timeline || ''
    }
  };
}