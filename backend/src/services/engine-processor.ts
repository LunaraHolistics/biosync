// 📦 engine-processor.ts
import { supabase } from '../config/supabase';
import { MarcadorBio, ResultadoBioSync } from '../types';

// ==============================
// 🔥 PESOS EMOCIONAIS PADRÃO (FALLBACK PARA ITENS SEM BASE)
// ==============================
const PESOS_EMOCIONAIS_PADRAO: Record<string, number> = {
  'amor': 75, 'alegria': 70, 'paz': 65, 'iluminismo': 50,
  'vergonha': 30, 'culpa': 25, 'apatia': 20, 'medo': 35,
  'desejo': 45, 'raiva': 40, 'orgulho': 55, 'coragem': 60,
  'neutralidade': 50, 'vontade': 65, 'aceitacao': 70, 'razao': 75,
  'tristeza': 35, 'ansiedade': 30, 'depressao': 25, 'estresse': 35,
  'frustracao': 40, 'inseguranca': 35, 'solidao': 30, 'luto': 25,
  'confianca': 70, 'esperanca': 75, 'gratidao': 80, 'compaixao': 75
};

// ==============================
// TIPOS EXPORTADOS
// ==============================

export interface RawDeviceItem {
  nome: string;
  percentual?: number;
  categoria?: string;
}

export interface MatchClinico {
  itemBase: string;
  categoria: string;
  score: number;
  gravidade: 'baixo' | 'normal' | 'alto';
  impacto: string;
  impacto_fitness?: {
    performance?: string;
    hipertrofia?: string;
    emagrecimento?: string;
    recuperacao?: string;
    humor?: string;
  };
}

interface CorrelationRecord {
  marcador_nome: string;
  afeta_desempenho_fisico: boolean;
  afeta_sono: boolean;
  afeta_metabolismo: boolean;
  afeta_emocional: boolean;
  descricao_impacto: string;
}

interface TermRecord {
  item: string;
  client_friendly_term: string;
  trainer_friendly_term: string;
  mode_tags: string[];
}

interface ProtocolRecord {
  condition_key: string;
  therapy_suggestions: string[];
  action_checklist: string[];
  expected_timeline: string;
  mode_relevance: string[];
}

interface ProcessedItem {
  raw: string;
  client_term: string;
  trainer_term: string;
  score: number;
  categoria: string;
  impacts: {
    fitness: boolean;
    sleep: boolean;
    metabolism: boolean;
    emotional: boolean;
    description: string;
  } | null;
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
  // 🔥 NOVO: Matches para histórico de evolução por item
  matches: MatchClinico[];
}

// ==============================
// 🔥 FUNÇÃO AUXILIAR: Calcular score com fallback emocional
// ==============================
function calcularScoreParaItem(
  itemNome: string,
  categoria: string,
  percentual?: number
): number {
  // 1. Se tiver percentual válido do dispositivo, usar como base
  if (percentual !== undefined && percentual !== null && percentual > 0) {
    // Ajustar: percentual alto = bom (score alto), percentual baixo = ruim (score baixo)
    return Math.min(100, Math.max(0, Math.round(percentual)));
  }

  // 2. Fallback: usar pesos emocionais padrão se for categoria emotional
  const itemNorm = itemNome.toLowerCase().trim();
  if (categoria.toLowerCase() === 'emotional' || categoria.toLowerCase() === 'emocional' || categoria.toLowerCase() === 'nivel de consciencia humana') {
    for (const [key, peso] of Object.entries(PESOS_EMOCIONAIS_PADRAO)) {
      if (itemNorm.includes(key) || key.includes(itemNorm)) {
        return peso;
      }
    }
    // Default para emocional sem match específico
    return 50;
  }

  // 3. Fallback genérico
  return 50;
}

// ==============================
// 🔥 FUNÇÃO AUXILIAR: Classificar gravidade baseada no score
// ==============================
function classificarGravidade(score: number): 'baixo' | 'normal' | 'alto' {
  if (score < 40) return 'baixo';
  if (score < 70) return 'normal';
  return 'alto';
}

// ==============================
// 🔥 FUNÇÃO AUXILIAR: Mapear impacto fitness
// ==============================
function mapearImpactoFitness(categoria: string, score: number): MatchClinico['impacto_fitness'] {
  const catNorm = categoria.toLowerCase();
  
  if (catNorm.includes('metabolismo') || catNorm.includes('gordura') || catNorm.includes('obesidade')) {
    return {
      emagrecimento: score < 50 ? 'Metabolismo comprometido, requer estímulo dietético.' : 'Metabolismo equilibrado.',
      performance: score < 50 ? 'Queda de energia disponível para treinos.' : 'Energia adequada para atividades.'
    };
  }
  
  if (catNorm.includes('muscular') || catNorm.includes('articul') || catNorm.includes('osseo')) {
    return {
      hipertrofia: score < 50 ? 'Capacidade de recuperação entre séries reduzida.' : 'Recuperação muscular adequada.',
      recuperacao: score < 50 ? 'Dor ou inflamação podem aumentar tempo de repouso.' : 'Recuperação dentro do esperado.'
    };
  }
  
  if (catNorm.includes('cardiovascular') || catNorm.includes('pulmonar') || catNorm.includes('sangu')) {
    return {
      performance: score < 50 ? 'Capacidade aeróbica reduzida, fadiga precoce.' : 'Capacidade cardiovascular adequada.',
      recuperacao: score < 50 ? 'Frequência cardíaca de repouso pode estar alterada.' : 'Recuperação cardiovascular normal.'
    };
  }
  
  if (catNorm.includes('nervoso') || catNorm.includes('emocional') || catNorm.includes('consciencia')) {
    return {
      humor: score < 50 ? 'Instabilidade afetando motivação e foco.' : 'Equilíbrio emocional adequado.',
      performance: score < 50 ? 'Foco e concentração podem estar prejudicados.' : 'Foco e clareza mental adequados.'
    };
  }
  
  return undefined;
}

// ==============================
// FUNÇÃO PRINCIPAL
// ==============================

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
  const { data: terms, error: errTerms } = await supabase.from('base_analise_saude').select('item, client_friendly_term, trainer_friendly_term, mode_tags, categoria');

  if (errCorr) console.error("❌ Erro ao carregar correlacoes_marcadores:", errCorr);
  if (errProt) console.error("❌ Erro ao carregar protocolos_base:", errProt);
  if (errTerms) console.error("❌ Erro ao carregar base_analise_saude:", errTerms);

  console.log("🗺️ Tamanho dos mapas carregados:");
  console.log("- correlacoes_marcadores:", correlations?.length || 0);
  console.log("- protocolos_base:", protocols?.length || 0);
  console.log("- base_analise_saude:", terms?.length || 0);

  // ✅ Tipagem explícita nos .map()
  const correlationMap = new Map<string, CorrelationRecord>(
    (correlations || []).map((c: any) => [String(c.marcador_nome).toLowerCase().trim(), c as CorrelationRecord])
  );

  const termMap = new Map<string, TermRecord>(
    (terms || []).map((t: any) => [String(t.item).toLowerCase().trim(), t as TermRecord])
  );

  console.log("📊 Mapas criados - correlationMap size:", correlationMap.size);
  console.log("📊 Mapas criados - termMap size:", termMap.size);

  // 2️⃣ FILTRAR, TRADUZIR E CALCULAR SCORES INDIVIDUAIS
  console.log(`\n🔍 Processando ${rawItems.length} itens do dispositivo...`);

  const processedItems: ProcessedItem[] = rawItems.map((item: RawDeviceItem) => {
    const key = item.nome.toLowerCase().trim();
    const corr = correlationMap.get(key);
    const term = termMap.get(key);
    
    // 🔥 Determinar categoria do item
    const categoria = term?.mode_tags?.[0] || item.categoria || 'Outros';
    
    // 🔥 Calcular score com fallback emocional
    const score = calcularScoreParaItem(item.nome, categoria, item.percentual);

    if (rawItems.indexOf(item) < 10) {
      console.log(`\n📝 Item "${item.nome}" (key: "${key}"):`);
      console.log(`   - correlationMap.has("${key}"): ${correlationMap.has(key)}`);
      console.log(`   - termMap.has("${key}"): ${termMap.has(key)}`);
      console.log(`   - categoria: ${categoria}`);
      console.log(`   - score calculado: ${score}`);
    }

    return {
      raw: item.nome,
      client_term: term?.client_friendly_term || item.nome,
      trainer_term: term?.trainer_friendly_term || '',
      score,
      categoria,
      impacts: corr ? {
        fitness: corr.afeta_desempenho_fisico,
        sleep: corr.afeta_sono,
        metabolism: corr.afeta_metabolismo,
        emotional: corr.afeta_emocional,
        description: corr.descricao_impacto || ''
      } : null
    };
  });

  // 🔥 3️⃣ CRIAR MATCHES PARA HISTÓRICO DE EVOLUÇÃO
  const matches: MatchClinico[] = processedItems.map(item => ({
    itemBase: item.client_term,
    categoria: item.categoria,
    score: item.score,
    gravidade: classificarGravidade(item.score),
    impacto: item.impacts?.description || 'Desequilíbrio bioenergético identificado',
    impacto_fitness: mapearImpactoFitness(item.categoria, item.score)
  }));

  console.log(`✅ Matches gerados: ${matches.length} itens com scores individuais`);

  // 4️⃣ ROTEAMENTO POR MODO
  const modeWeights: Record<string, string[]> = {
    fitness: ['fitness', 'immunity'],
    weight_loss: ['metabolism', 'emotional'],
    emotional_sleep: ['sleep', 'emotional'],
    immunity: ['immunity', 'fitness'],
    mental: ['emotional', 'sleep']
  };

  const activeTags = modeWeights[selectedMode] || ['geral'];
  const relevantItems = processedItems.filter(item => {
    if (!item.impacts) return false;
    return activeTags.some(tag =>
      (tag === 'fitness' && item.impacts?.fitness) ||
      (tag === 'sleep' && item.impacts?.sleep) ||
      (tag === 'metabolism' && item.impacts?.metabolism) ||
      (tag === 'emotional' && item.impacts?.emotional) ||
      (tag === 'immunity' && item.impacts?.fitness)
    );
  });

  // 5️⃣ CÁLCULO DE SCORES POR CATEGORIA (para dashboard)
  const calculateScore = (items: ProcessedItem[]): number => {
    if (items.length === 0) return 75;
    const validItems = items.filter(i => i.score !== undefined && i.score !== null);
    if (validItems.length === 0) return 75;
    const avgDesequilibrio = validItems.reduce((acc, curr) => acc + (100 - curr.score), 0) / validItems.length;
    return Math.max(0, Math.min(100, Math.round(100 - avgDesequilibrio)));
  };

  const category_scores = {
    fitness: calculateScore(relevantItems.filter(i => i.impacts?.fitness)),
    emotional: calculateScore(processedItems.filter(i => i.impacts?.emotional)),
    sono: calculateScore(processedItems.filter(i => i.impacts?.sleep)),
    imunidade: calculateScore(processedItems.filter(i => i.impacts?.fitness || i.impacts?.metabolism)),
    mental: calculateScore(processedItems.filter(i => i.impacts?.emotional || i.impacts?.sleep))
  };

  // 6️⃣ IDENTIFICAR TOP 3 CRÍTICOS
  const critical_alerts = relevantItems
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(item => ({
      item: item.client_term,
      score: item.score,
      impact: item.impacts?.description || 'Desequilíbrio bioenergético identificado'
    }));

  // 7️⃣ QUICK WINS
  const quick_wins = relevantItems
    .filter(i => {
      const desc = i.impacts?.description || '';
      return i.score < 45 && (desc.includes('suplemento') || desc.includes('respiração'));
    })
    .slice(0, 3)
    .map(item => ({
      item: item.client_term,
      action: `Focar em ${item.client_term} com protocolo específico`,
      expected: 'Melhora perceptível em 7-14 dias'
    }));

  // 8️⃣ MATCH COM PROTOCOLOS
  const protocolsList = protocols || [];
  const matchedProtocol = protocolsList.find((p: any) =>
    critical_alerts.length > 0 &&
    p.condition_key.toLowerCase().includes(
      critical_alerts[0]?.item.toLowerCase().split('(')[0].trim() || 'general'
    )
  ) || protocolsList[0];

  // 9️⃣ CÁLCULO IMC
  let imc_value: number | null = null;
  let imc_status: string | null = null;
  if (clientWeight && clientHeightMeters && clientHeightMeters > 0) {
    imc_value = Math.round((clientWeight / (clientHeightMeters ** 2)) * 10) / 10;
    if (imc_value < 18.5) imc_status = 'Abaixo do peso';
    else if (imc_value < 24.9) imc_status = 'Normal';
    else if (imc_value < 29.9) imc_status = 'Sobrepeso';
    else imc_status = 'Obesidade';
  }

  // 🔟 RETORNAR COM MATCHES INCLUÍDOS
  return {
    modo_selecionado: selectedMode,
    category_scores,
    critical_alerts,
    quick_wins,
    imc_value,
    imc_status,
    translated_items: processedItems.map(i => ({
      raw: i.raw,
      client_term: i.client_term,
      trainer_term: i.trainer_term
    })),
    suggested_protocol: {
      therapies: matchedProtocol?.therapy_suggestions || [],
      checklist: matchedProtocol?.action_checklist || [],
      timeline: matchedProtocol?.expected_timeline || ''
    },
    // 🔥 NOVO: Matches para histórico de evolução por item
    matches
  };
}