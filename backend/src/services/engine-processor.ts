// 📦 engine-processor.ts
import { createClient } from '@supabase/supabase-js';
import { MarcadorBio, ResultadoBioSync } from '../types';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export interface RawDeviceItem {
  nome: string;
  percentual?: number;
  categoria?: string;
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

  if (errCorr) console.error("❌ Erro ao carregar correlacoes_marcadores:", errCorr);
  if (errProt) console.error("❌ Erro ao carregar protocolos_base:", errProt);
  if (errTerms) console.error("❌ Erro ao carregar base_analise_saude:", errTerms);

  console.log("🗺️ Tamanho dos mapas carregados:");
  console.log("- correlacoes_marcadores:", correlations?.length || 0);
  console.log("- protocolos_base:", protocols?.length || 0);
  console.log("- base_analise_saude:", terms?.length || 0);

  const correlationMap = new Map<string, CorrelationRecord>(
    (correlations || []).map(c => [c.marcador_nome.toLowerCase().trim(), c as CorrelationRecord])
  );

  const termMap = new Map<string, TermRecord>(
    (terms || []).map(t => [t.item.toLowerCase().trim(), t as TermRecord])
  );

  console.log("📊 Mapas criados - correlationMap size:", correlationMap.size);
  console.log("📊 Mapas criados - termMap size:", termMap.size);

  // 2️⃣ FILTRAR E TRADUZIR ITENS
  console.log(`\n🔍 Processando ${rawItems.length} itens do dispositivo...`);

  const processedItems: ProcessedItem[] = rawItems.map((item: MarcadorBio) => {
    const key = item.nome.toLowerCase().trim();
    const corr = correlationMap.get(key);
    const term = termMap.get(key);

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
        description: corr.descricao_impacto || ''
      } : null
    };
  });

  // 3️⃣ ROTEAMENTO POR MODO
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

  // 4️⃣ CÁLCULO DE SCORES POR CATEGORIA
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

  // 5️⃣ IDENTIFICAR TOP 3 CRÍTICOS
  const critical_alerts = relevantItems
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(item => ({
      item: item.client_term,
      score: item.score,
      impact: item.impacts?.description || 'Desequilíbrio bioenergético identificado'
    }));

  // 6️⃣ QUICK WINS
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

  // 7️⃣ MATCH COM PROTOCOLOS
  const protocolsList = protocols || [];
  const matchedProtocol = protocolsList.find((p: ProtocolRecord) =>
    critical_alerts.length > 0 &&
    p.condition_key.toLowerCase().includes(
      critical_alerts[0]?.item.toLowerCase().split('(')[0].trim() || 'general'
    )
  ) || protocolsList[0];

  // 8️⃣ CÁLCULO IMC
  let imc_value: number | null = null;
  let imc_status: string | null = null;
  if (clientWeight && clientHeightMeters && clientHeightMeters > 0) {
    imc_value = Math.round((clientWeight / (clientHeightMeters ** 2)) * 10) / 10;
    if (imc_value < 18.5) imc_status = 'Abaixo do peso';
    else if (imc_value < 24.9) imc_status = 'Normal';
    else if (imc_value < 29.9) imc_status = 'Sobrepeso';
    else imc_status = 'Obesidade';
  }

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
    }
  };
}