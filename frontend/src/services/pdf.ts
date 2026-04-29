// services/pdf.ts

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import type { PlanoTerapeutico } from "../types/planoTerapeutico";

const PDF_CANVAS_SCALE = 2;
const MAX_CHARS_POR_BLOCO = 2400;
const MARGEM_PDF = 20;
const ALTURA_RODAPE = 40;

// =======================================================================
// 🔥 TIPOS
// =======================================================================

export type ItemScoreEvolucao = {
  item: string;
  categoria: string;
  score_atual: number;
  score_anterior: number | null;
  delta: number;
  trend: 'melhorou' | 'piorou' | 'estavel' | 'novo';
  impacto: string;
};

export type RelatorioData = {
  clientName: string;
  createdAt: string | Date;
  interpretacao: string;
  pontos_criticos: string[];
  diagnostico?: {
    problemas: {
      sistema: string;
      item: string;
      status: string;
      impacto: string;
      score?: number;
      impacto_fitness?: {
        performance?: string;
        hipertrofia?: string;
        emagrecimento?: string;
        recuperacao?: string;
        humor?: string;
      };
    }[];
  };
  plano_terapeutico?: PlanoTerapeutico;
  frequencia_lunara: string;
  justificativa: string;
  comparacao?: unknown;
  relatorio_original_html?: string;
  filtros_aplicados?: string[];
  item_scores?: ItemScoreEvolucao[];
  pacienteGenero?: 'masculino' | 'feminino';
};

// =======================================================================
// 🔥 HELPERS BÁSICOS
// =======================================================================

function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("pt-BR", {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(d);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function dividirTexto(texto: string, maxChars: number): string[] {
  if (texto.length <= maxChars) return [texto];
  const pedacos: string[] = [];
  let resto = texto;
  while (resto.length > 0) {
    if (resto.length <= maxChars) {
      pedacos.push(resto);
      break;
    }
    let corte = resto.lastIndexOf("\n", maxChars);
    if (corte <= maxChars * 0.3) {
      corte = resto.lastIndexOf(" ", maxChars);
    }
    if (corte <= maxChars * 0.3) corte = maxChars;
    pedacos.push(resto.substring(0, corte));
    resto = resto.substring(corte).trimStart();
  }
  return pedacos;
}

function criarBlocoHTML(html: string, comBordaInferior = false): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = `
    width: 694px;
    padding: 16px 20px;
    background: #ffffff;
    border-radius: 6px;
    font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
    color: #111111;
    font-size: 11px;
    line-height: 15px;
    margin-bottom: 12px;
    ${comBordaInferior ? "border-bottom: 1px solid #e5e7eb;" : ""}
    page-break-inside: avoid;
    break-inside: avoid;
  `;
  el.innerHTML = html;
  return el;
}

async function renderizarBlocoParaCanvas(el: HTMLElement, scale: number) {
  return html2canvas(el, {
    scale,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    scrollY: -window.scrollY,
  });
}

function adicionarBlocoAoPDF(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  currentY: number,
  pageWidth: number,
  pageHeight: number
): number {
  const marginX = MARGEM_PDF;
  const maxY = pageHeight - ALTURA_RODAPE;
  const imgData = canvas.toDataURL("image/png");
  const imgWidth = pageWidth - marginX * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  if (currentY + imgHeight > maxY) {
    pdf.addPage();
    currentY = MARGEM_PDF;
  }

  pdf.addImage(imgData, "PNG", marginX, currentY, imgWidth, imgHeight);
  return currentY + imgHeight + 8;
}

// =======================================================================
// 🔥 FILTRO DE GÊNERO — VERSÃO REFORÇADA E ROBUSTA
// =======================================================================

function normalizarNomeItem(nome: string): string {
  return nome.trim().replace(/[:：]$/, '').replace(/\s+/g, ' ');
}

function filtrarPorGenero(item: string, genero?: 'masculino' | 'feminino'): boolean {
  if (!genero) return true;
  
  const itemClean = normalizarNomeItem(item).toLowerCase();
  
  // 🔥 Lista expandida de itens masculinos
  const itensMasculinos = [
    'testosterona', 'próstata', 'prostata', 'androgênio', 'androgenio', 'andrógeno',
    'hormona masculina', 'hormônio masculino', 'esperma', 'espermatozóide', 'espermatozoide',
    'ereção', 'ejaculação', 'líbido masculina', 'hipertrofia prostática',
    'volume de sêmen', 'motilidade do esperma', 'transmissor da ereção',
    'gonadotrofina masculina', 'função sexual masculina', 'androstenediona',
    'dht', 'dihidrotestosterona', 'shbg', 'globulina ligadora'
  ];
  
  // 🔥 Lista expandida de itens femininos
  const itensFemininos = [
    'estrogênio', 'estrogenio', 'estrogénio', 'progesterona', 'prolactina',
    'hormona feminina', 'hormônio feminino', 'ovário', 'ovarios', 'útero', 'utero',
    'colo uterino', 'menstruação', 'menstruacao', 'ciclo menstrual', 'menopausa',
    'gravidez', 'amamentação', 'amamentacao', 'mastite', 'cisto ovario',
    'inflamação pélvica', 'anexite', 'cervicite', 'vaginite', 'ginecologia',
    'endométrio', 'miométrio', 'fsh', 'lh', 'hormona luteinizante'
  ];
  
  if (genero === 'masculino') {
    return !itensFemininos.some(f => itemClean.includes(f));
  } else {
    return !itensMasculinos.some(m => itemClean.includes(m));
  }
}

// =======================================================================
// 🔥 DETECÇÃO DE ITENS RELACIONADOS A SONO/INSÔNIA E EMOÇÕES
// =======================================================================

function isItemSono(item: string): boolean {
  const itemClean = normalizarNomeItem(item).toLowerCase();
  const palavrasSono = [
    'sono', 'insônia', 'insonia', 'melatonina', 'dormir', 'descanso',
    'fadiga', 'magnésio', 'magnesio', 'equilíbrio hepático', 'equilibrio hepatico',
    'secreção de bílis', 'secrecao de bilis', 'triptofano', 'gaba',
    'relaxamento', 'calma', 'ansiedade', 'estresse', 'cortisol',
    'serotonina', 'adrenalina', 'sistema nervoso', 'neurotransmissor'
  ];
  return palavrasSono.some(p => itemClean.includes(p));
}

function isItemEmocional(item: string): boolean {
  const itemClean = normalizarNomeItem(item).toLowerCase();
  const emocoes = [
    'amor', 'alegria', 'paz', 'iluminismo', 'vergonha', 'culpa', 'apatia',
    'dor', 'medo', 'desejo', 'raiva', 'orgulho', 'coragem', 'neutralidade',
    'vontade', 'aceitação', 'razão', 'nível de consciência', 'consciencia humana'
  ];
  return emocoes.some(e => itemClean.includes(e));
}

// =======================================================================
// 🔥 COMPARATIVO ENTRE EXAMES
// =======================================================================

function extrairComparativoHTML(comparacao: unknown): string {
  if (!comparacao || typeof comparacao !== "object") return "";
  const c = comparacao as Record<string, unknown>;
  const secoes: { titulo: string; cor: string; itens: any[] }[] = [
    { titulo: "🟢 Melhoraram", cor: "#16a34a", itens: Array.isArray(c.melhoraram) ? c.melhoraram : [] },
    { titulo: "🔴 Pioraram", cor: "#dc2626", itens: Array.isArray(c.pioraram) ? c.pioraram : [] },
    { titulo: "🟡 Novos Problemas", cor: "#ca8a04", itens: Array.isArray(c.novos_problemas) ? c.novos_problemas : [] },
    { titulo: "⚪ Normalizados", cor: "#6b7280", itens: Array.isArray(c.normalizados) ? c.normalizados : [] },
  ];
  const total = secoes.reduce((s, sec) => s + sec.itens.length, 0);
  if (total === 0) return "";

  const partes: string[] = [`<div style="font-weight:900;margin-bottom:10px;font-size:12px">Evolução entre exames (${total} mudanças)</div>`];
  for (const secao of secoes) {
    if (secao.itens.length === 0) continue;
    const linhas = secao.itens.slice(0, 10).map((item: any) => `
      <div style="margin-bottom:4px;font-size:10px">
        <b>${escapeHtml(item.item || "—")}</b>
        <span style="color:${secao.cor}"> ${escapeHtml(item.evolucao || "")}</span>
        <span style="font-size:9px;opacity:0.7">
          ${item.antes ? escapeHtml(String(item.antes)) : "—"} → ${item.depois ? escapeHtml(String(item.depois)) : "—"}
          ${item.variacao !== undefined ? ` | Δ${item.variacao}` : ""}
        </span>
      </div>
    `).join("");
    partes.push(`
      <div style="margin-bottom:10px;padding:8px;background:#f9fafb;border-radius:4px">
        <div style="font-weight:700;color:${secao.cor};margin-bottom:4px;font-size:11px">
          ${secao.titulo} (${secao.itens.length})
        </div>
        ${linhas}
      </div>
    `);
  }
  return partes.join("");
}

// =======================================================================
// 🔥 TABELA DE EVOLUÇÃO — COM FILTRO, DEDUPLICAÇÃO E DESTAQUE
// =======================================================================

function gerarTabelaEvolucao(itemScores: ItemScoreEvolucao[], genero?: 'masculino' | 'feminino'): string {
  if (!itemScores || itemScores.length === 0) return '';

  // 🔥 1. Filtrar por gênero
  let filtrados = itemScores.filter(is => filtrarPorGenero(is.item, genero));
  
  // 🔥 2. Deduplicar: normalizar nomes e manter apenas o mais crítico
  const mapaUnico = new Map<string, ItemScoreEvolucao>();
  for (const is of filtrados) {
    const chave = normalizarNomeItem(is.item).toLowerCase();
    // Manter versão com score mais baixo (mais crítico) ou maior impacto
    const existente = mapaUnico.get(chave);
    if (!existente || is.score_atual < existente.score_atual || is.impacto.length > existente.impacto.length) {
      mapaUnico.set(chave, { ...is, item: normalizarNomeItem(is.item) });
    }
  }
  filtrados = Array.from(mapaUnico.values());
  
  if (filtrados.length === 0) return '';

  // 🔥 3. Ordenar: sono/emoções primeiro → maior impacto → score mais crítico → alfabético
  const temSono = filtrados.some(is => isItemSono(is.item));
  const temEmocional = filtrados.some(is => isItemEmocional(is.item));
  
  const ordenados = [...filtrados].sort((a, b) => {
    // 1. Itens de sono primeiro
    if (temSono) {
      const aSono = isItemSono(a.item) ? 2 : 0;
      const bSono = isItemSono(b.item) ? 2 : 0;
      if (aSono !== bSono) return bSono - aSono;
    }
    // 2. Itens emocionais em segundo
    if (temEmocional) {
      const aEmo = isItemEmocional(a.item) ? 1 : 0;
      const bEmo = isItemEmocional(b.item) ? 1 : 0;
      if (aEmo !== bEmo) return bEmo - aEmo;
    }
    // 3. Depois por impacto (maior |delta|)
    if (Math.abs(b.delta) !== Math.abs(a.delta)) return Math.abs(b.delta) - Math.abs(a.delta);
    // 4. Depois por score atual (mais crítico primeiro)
    if (a.score_atual !== b.score_atual) return a.score_atual - b.score_atual;
    // 5. Finalmente alfabético
    return normalizarNomeItem(a.item).localeCompare(normalizarNomeItem(b.item), 'pt-BR');
  }).slice(0, 15);

  const linhas = ordenados.map(item => {
    const icon = item.trend === 'melhorou' ? '🟢' :
      item.trend === 'piorou' ? '🔴' :
        item.trend === 'novo' ? '🆕' : '🟡';
    
    const destaqueSono = isItemSono(item.item) 
      ? 'background: #fef3c7; border-left: 3px solid #f59e0b; padding-left: 6px;' 
      : '';
    const destaqueEmocional = isItemEmocional(item.item) && !isItemSono(item.item)
      ? 'background: #f0f9ff; border-left: 3px solid #3b82f6; padding-left: 6px;'
      : '';
    const destaque = destaqueSono || destaqueEmocional;

    const deltaStr = item.score_anterior !== null
      ? `${item.delta >= 0 ? '+' : ''}${item.delta}`
      : '—';

    const scoreAnterior = item.score_anterior !== null ? item.score_anterior : '—';
    const corDelta = item.delta >= 0 ? '#16a34a' : '#dc2626';
    const corScore = item.score_atual >= 70 ? '#16a34a' : item.score_atual >= 50 ? '#ca8a04' : '#dc2626';

    const emoji = isItemSono(item.item) ? '😴 ' : isItemEmocional(item.item) ? '💙 ' : '';

    return `
      <tr style="border-bottom: 1px solid #f1f5f9; ${destaque}">
        <td style="padding: 8px 4px; font-size: 10px; font-weight: 600; color: #1e293b; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${emoji}${escapeHtml(item.item)}
        </td>
        <td style="padding: 8px 4px; font-size: 10px; text-align: center; color: #475569;">${scoreAnterior}</td>
        <td style="padding: 8px 4px; font-size: 10px; text-align: center; font-weight: 700; color: ${corScore};">${item.score_atual}</td>
        <td style="padding: 8px 4px; font-size: 10px; text-align: center; font-weight: 700; color: ${corDelta};">${deltaStr}</td>
        <td style="padding: 8px 4px; font-size: 10px; text-align: center;">${icon}</td>
      </tr>
    `;
  }).join('');

  const resumo = {
    melhoraram: ordenados.filter(i => i.trend === 'melhorou').length,
    pioraram: ordenados.filter(i => i.trend === 'piorou').length,
    estaveis: ordenados.filter(i => i.trend === 'estavel').length,
    novos: ordenados.filter(i => i.trend === 'novo').length
  };

  const badgeSono = temSono ? '<span style="margin-left: 8px; font-size: 10px; background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-weight: 600;">😴 Sono</span>' : '';
  const badgeEmocional = temEmocional && !temSono ? '<span style="margin-left: 8px; font-size: 10px; background: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 4px; font-weight: 600;">💙 Emoções</span>' : '';

  return `
    <div style="margin: 20px 0; page-break-inside: avoid;" data-pdf-section="evolucao">
      <div style="font-size: 13px; font-weight: 800; color: #0f172a; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
        <span>📈</span> Evolução dos Principais Itens
        ${badgeSono}${badgeEmocional}
      </div>
      <div style="display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
        ${resumo.melhoraram > 0 ? `<span style="background: #dcfce7; color: #166534; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">🟢 ${resumo.melhoraram} melhoraram</span>` : ''}
        ${resumo.estaveis > 0 ? `<span style="background: #fef3c7; color: #92400e; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">🟡 ${resumo.estaveis} estáveis</span>` : ''}
        ${resumo.pioraram > 0 ? `<span style="background: #fee2e2; color: #991b1b; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">🔴 ${resumo.pioraram} pioraram</span>` : ''}
        ${resumo.novos > 0 ? `<span style="background: #dbeafe; color: #1e40af; padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">🆕 ${resumo.novos} novos</span>` : ''}
      </div>
      <div style="font-size: 9px; color: #64748b; margin-bottom: 8px; font-style: italic;">
        Comparativo com exame anterior • 🟢 Melhorou (≥10 pts) • 🟡 Estável (±9 pts) • 🔴 Piorou (≤-10 pts) • 🆕 Novo
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
        <thead>
          <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
            <th style="padding: 8px 4px; text-align: left; font-weight: 700; color: #334155; width: 45%;">Item</th>
            <th style="padding: 8px 4px; text-align: center; font-weight: 700; color: #334155; width: 12%;">Anterior</th>
            <th style="padding: 8px 4px; text-align: center; font-weight: 700; color: #334155; width: 12%;">Atual</th>
            <th style="padding: 8px 4px; text-align: center; font-weight: 700; color: #334155; width: 10%;">Δ</th>
            <th style="padding: 8px 4px; text-align: center; font-weight: 700; color: #334155; width: 10%;">Status</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
    </div>
  `;
}

// =======================================================================
// 🔥 FUNÇÃO AUXILIAR: Seção Explicativa de Itens Prioritários
// =======================================================================

function gerarSecaoExplicativa(itemScores: ItemScoreEvolucao[]): string {
  if (!itemScores || itemScores.length === 0) return '';
  
  // Filtrar itens críticos (score < 60) relacionados a sono, emoções ou bem-estar
  const itensCriticos = itemScores
    .filter(is => is.score_atual < 60 && (isItemSono(is.item) || isItemEmocional(is.item)))
    .sort((a, b) => a.score_atual - b.score_atual)
    .slice(0, 5);
  
  if (itensCriticos.length === 0) return '';
  
  // 🔥 Base de conhecimento explicativa EXPANDIDA
  const explicacoes: Record<string, {titulo: string; explicacao: string; recomendacao: string}> = {
    // Sono e relaxamento
    'Magnésio': {
      titulo: 'Magnésio (Relaxamento e Sono)',
      explicacao: 'O magnésio é essencial para o relaxamento muscular, produção de melatonina e regulação do sistema nervoso. Deficiência causa insônia, ansiedade, tensão muscular, cãibras e fadiga crônica.',
      recomendacao: 'Suplementação com magnésio quelado (300-400mg/dia), alimentos ricos (castanhas, espinafre, abacate), banhos de sal grosso, evitar café após 14h.'
    },
    'Triptofano': {
      titulo: 'Triptofano',
      explicacao: 'Aminoácido precursor da serotonina e melatonina. Essencial para indução e qualidade do sono. Baixos níveis causam insônia, depressão e ansiedade.',
      recomendacao: 'Alimentos ricos (banana, aveia, leite, peru, castanhas), suplementação (500-1000mg antes de dormir), evitar proteínas pesadas à noite.'
    },
    'Fadiga visual': {
      titulo: 'Fadiga Visual',
      explicacao: 'Cansaço mental e ocular que prejudica o ciclo sono-vigília. Excesso de telas, luz azul e esforço visual constante ativam o sistema nervoso simpático, dificultando o relaxamento noturno.',
      recomendacao: 'Regra 20-20-20 (a cada 20min, olhar 20 pés por 20 seg), filtro de luz azul após 18h, óleos essenciais de lavanda, pausas ativas.'
    },
    'Equilíbrio Hepático': {
      titulo: 'Equilíbrio Hepático (Metabolismo e Sono)',
      explicacao: 'Fígado sobrecarregado prejudica desintoxicação noturna, metabolismo de hormônios e produção de bile. Sono entre 23h-3h é crucial para regeneração hepática.',
      recomendacao: 'Evitar álcool e alimentos processados, chás digestivos (boldo, carqueja), jantar leve até 19h, dormir antes de 23h.'
    },
    'Função de secreção de bílis': {
      titulo: 'Função Biliar',
      explicacao: 'Bile inadequada prejudica digestão de gorduras, absorção de vitaminas lipossolúveis (D, E, K) e desintoxicação. Impacta qualidade do sono e energia.',
      recomendacao: 'Gorduras saudáveis (azeite, abacate), limão em jejum, chás de boldo ou dente-de-leão, evitar frituras.'
    },
    'Sistema Nervoso': {
      titulo: 'Sistema Nervoso',
      explicacao: 'Hiperatividade do sistema nervoso simpático (luta/fuga) impede relaxamento necessário para dormir. Estresse crônico eleva cortisol noturno.',
      recomendacao: 'Técnicas de respiração (4-7-8), meditação, yoga, evitar notícias à noite, rotina de sono consistente.'
    },
    // Emoções / Nível de Consciência
    'Amor': {
      titulo: 'Amor (Nível de Consciência)',
      explicacao: 'Estado emocional de conexão, compaixão e aceitação. Score baixo indica bloqueios emocionais, dificuldade em se conectar ou ressentimentos não resolvidos.',
      recomendacao: 'Práticas de gratidão, terapia de perdão, meditação do coração, journaling emocional, flores de Bach (Walnut, Holly).'
    },
    'Alegria': {
      titulo: 'Alegria (Nível de Consciência)',
      explicacao: 'Capacidade de experimentar prazer, leveza e entusiasmo. Score baixo sugere depressão leve, apatia ou dificuldade em celebrar a vida.',
      recomendacao: 'Atividades prazerosas diárias, música alegre, dança, terapia cognitivo-comportamental, suplementação com vitamina D e ômega-3.'
    },
    'Paz': {
      titulo: 'Paz (Nível de Consciência)',
      explicacao: 'Estado de serenidade interior e equilíbrio emocional. Score baixo indica ansiedade, agitação mental ou conflitos internos não resolvidos.',
      recomendacao: 'Meditação mindfulness, respiração diafragmática, chás calmantes (camomila, erva-cidreira), ambiente tranquilo para descanso.'
    },
    'Vergonha': {
      titulo: 'Vergonha (Nível de Consciência)',
      explicacao: 'Emoção de baixa vibração que gera isolamento e autocrítica excessiva. Score muito baixo indica trauma, baixa autoestima ou padrões de autossabotagem.',
      recomendacao: 'Terapia de aceitação e compromisso (ACT), afirmações positivas, trabalho com sombra, apoio profissional especializado.'
    },
    'Medo': {
      titulo: 'Medo (Nível de Consciência)',
      explicacao: 'Emoção de proteção que, em excesso, paralisa e limita. Score baixo indica ansiedade generalizada, fobias ou insegurança crônica.',
      recomendacao: 'Exposição gradual, técnicas de grounding, florais de Bach (Mimulus, Rock Rose), suplementação com magnésio e L-teanina.'
    },
    'Raiva': {
      titulo: 'Raiva (Nível de Consciência)',
      explicacao: 'Emoção de defesa que, quando reprimida ou explosiva, causa desequilíbrio. Score baixo indica frustração acumulada, limites não estabelecidos ou injustiça percebida.',
      recomendacao: 'Expressão saudável da raiva (escrita, arte, exercício), assertividade, florais (Holly, Vine), técnicas de liberação emocional.'
    },
    'Culpa': {
      titulo: 'Culpa (Nível de Consciência)',
      explicacao: 'Sentimento de responsabilidade excessiva por eventos passados. Score baixo indica autocrítica rígida, dificuldade em perdoar a si mesmo ou padrões de vitimização.',
      recomendacao: 'Terapia de perdão, reestruturação cognitiva, práticas de autocompaixão, florais (Pine, Crab Apple).'
    },
    // Minerais e nutrientes
    'Potássio': {
      titulo: 'Potássio',
      explicacao: 'Mineral essencial para função muscular, nervosa e equilíbrio eletrolítico. Deficiência causa cãibras, fadiga, arritmias e sono fragmentado.',
      recomendacao: 'Alimentos ricos (banana, batata-doce, abacate, espinafre, feijão), evitar diuréticos em excesso.'
    },
    'Manganês': {
      titulo: 'Manganês',
      explicacao: 'Cofator enzimático para metabolismo, formação óssea e antioxidante. Deficiência afeta qualidade do sono e recuperação muscular.',
      recomendacao: 'Castanhas, grãos integrais, folhas verdes, chá verde.'
    },
    // Saúde geral
    'Metais Pesados': {
      titulo: 'Metais Pesados',
      explicacao: 'Acúmulo de chumbo, mercúrio, cádmio e alumínio causa toxicidade sistêmica, fadiga crônica, névoa mental e distúrbios do sono.',
      recomendacao: 'Desintoxicação com coentro, chlorella, zeolita, sauna, evitar peixes contaminados, panelas de alumínio.'
    },
    'Cardiovascular e Cerebrovascular': {
      titulo: 'Circulação Cardiovascular',
      explicacao: 'Má circulação cerebral e cardíaca prejudica oxigenação, cognição, qualidade do sono e recuperação noturna.',
      recomendacao: 'Exercícios aeróbicos, ginkgo biloba, ômega-3, hidratação, evitar sedentarismo.'
    },
    'Olhos': {
      titulo: 'Saúde Ocular',
      explicacao: 'Fadiga visual, olheiras e tensão ocular refletem estresse, sono inadequado e sobrecarga de telas.',
      recomendacao: 'Pausas ativas, compressas mornas, ômega-3, vitamina A (cenoura, abóbora).'
    },
    'Seios': {
      titulo: 'Saúde Mamária',
      explicacao: 'Desequilíbrios hormonais (estrogênio/progesterona) podem causar sensibilidade, cistos e desconforto. Impacta qualidade do sono e bem-estar.',
      recomendacao: 'Autoexame mensal, evitar cafeína, semente de linhaça, soutien adequado, acompanhamento médico.'
    },
    'Afrouxamento e queda': {
      titulo: 'Saúde Capilar',
      explicacao: 'Queda e enfraquecimento capilar indicam deficiências nutricionais (ferro, zinco, biotina), estresse e desequilíbrios hormonais.',
      recomendacao: 'Biotina, zinco, ferro, proteínas, massagem capilar, evitar químicas agressivas.'
    }
  };
  
  const htmlExplicacoes = itensCriticos.map(is => {
    const nome = normalizarNomeItem(is.item);
    const info = explicacoes[nome] || {
      titulo: nome,
      explicacao: isItemEmocional(nome) 
        ? 'Estado emocional que influencia qualidade de vida, sono e bem-estar. Score baixo indica necessidade de trabalho emocional e autocuidado.'
        : 'Desequilíbrio bioenergético que impacta sono, energia e bem-estar geral.',
      recomendacao: 'Avaliação profissional recomendada para protocolo personalizado.'
    };
    
    const corBadge = is.score_atual < 30 ? '#dc2626' : is.score_atual < 50 ? '#f97316' : '#ca8a04';
    const labelScore = is.score_atual < 30 ? 'Crítico' : is.score_atual < 50 ? 'Atenção' : 'Moderado';
    
    return `
      <div style="margin-bottom: 12px; padding: 12px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-left: 4px solid #f59e0b; border-radius: 6px;">
        <div style="font-weight: 800; color: #92400e; font-size: 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          ${isItemSono(nome) ? '😴' : isItemEmocional(nome) ? '💙' : '⚠️'} ${info.titulo} 
          <span style="background: ${corBadge}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600;">
            Score: ${is.score_atual} • ${labelScore}
          </span>
        </div>
        <div style="font-size: 10px; color: #78350f; margin-bottom: 6px; line-height: 1.5;">
          <b style="color: #92400e;">O que é:</b> ${info.explicacao}
        </div>
        <div style="font-size: 10px; color: #78350f; line-height: 1.5;">
          <b style="color: #92400e;">Recomendações:</b> ${info.recomendacao}
        </div>
      </div>
    `;
  }).join('');
  
  return `
    <div style="margin: 24px 0; page-break-inside: avoid;" data-pdf-section="explicacoes">
      <div style="font-size: 14px; font-weight: 900; color: #0f172a; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 20px;">🔍</span> 
        Por Que Estes Itens Estão Destacados?
      </div>
      <div style="font-size: 10px; color: #64748b; margin-bottom: 12px; font-style: italic; padding: 8px; background: #f8fafc; border-radius: 6px;">
        Itens relacionados ao sono, emoções e bem-estar com score crítico (< 60) que requerem atenção prioritária:
      </div>
      ${htmlExplicacoes}
      <div style="margin-top: 12px; padding: 10px; background: #dbeafe; border-radius: 6px; border-left: 4px solid #3b82f6;">
        <div style="font-size: 10px; color: #1e40af; font-weight: 700; margin-bottom: 4px;">💡 Dica Importante:</div>
        <div style="font-size: 10px; color: #1e40af;">
          A correção destes desequilíbrios pode levar de 2 a 8 semanas com protocolo adequado. 
          Priorize sono antes de 23h, alimentação limpa, gerenciamento de estresse e acompanhamento profissional.
        </div>
      </div>
    </div>
  `;
}

// =======================================================================
// 🔥 FUNÇÃO PRINCIPAL: gerarRelatorioPDF
// =======================================================================

export async function gerarRelatorioPDF(data: RelatorioData) {
  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed;
    left: -9999px;
    top: 0;
    width: 794px;
    padding: 24px;
    background: #ffffff;
    box-sizing: border-box;
  `;

  const blocks: HTMLElement[] = [];

  // 🔥 1. CABEÇALHO — Data formatada com hora
  const dataExibicao = data.createdAt instanceof Date 
    ? data.createdAt 
    : new Date(data.createdAt);
  
  const filtrosHTML = data.filtros_aplicados?.length
    ? `<div style="font-size:10px;color:#0ea5e9;margin-top:4px">
        🔍 Filtro: ${data.filtros_aplicados.map(f => f === 'emotional' ? 'Emocional' : f).join(', ')}
      </div>`
    : '';

  blocks.push(
    criarBlocoHTML(`
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <div style="font-size:18px;font-weight:900;color:#0f172a">BioSync Report</div>
          <div style="font-size:11px;color:#64748b">Relatório Terapêutico Integrativo</div>
        </div>
        <div style="text-align:right;font-size:10px;color:#64748b">
          <b>${escapeHtml(data.clientName)}</b><br/>
          ${formatDate(dataExibicao)}
        </div>
      </div>
      ${filtrosHTML}
    `, true)
  );

  // 🔥 2. INTERPRETAÇÃO
  if (data.interpretacao) {
    const pedacos = dividirTexto(data.interpretacao, MAX_CHARS_POR_BLOCO);
    for (let i = 0; i < pedacos.length; i++) {
      const titulo = i === 0 ? "📋 Interpretação" : "Interpretação (cont.)";
      blocks.push(
        criarBlocoHTML(`
          <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:6px">${titulo}</div>
          <div style="white-space:pre-wrap;color:#334155;font-size:11px;line-height:16px">${escapeHtml(pedacos[i])}</div>
        `, i < pedacos.length - 1)
      );
    }
  }

  // 🔥 3. PONTOS CRÍTICOS — COM FILTRO, DEDUPLICAÇÃO E DESTAQUE PARA SONO/EMOÇÕES
  if (data.pontos_criticos.length > 0) {
    let pontosFiltrados = data.pontos_criticos
      .filter(p => filtrarPorGenero(p, data.pacienteGenero))
      .map(p => normalizarNomeItem(p));
    
    // Remover duplicatas mantendo primeira ocorrência
    pontosFiltrados = [...new Set(pontosFiltrados)];
    
    // Destacar itens de sono e emocionais no topo
    const pontosSono = pontosFiltrados.filter(p => isItemSono(p));
    const pontosEmocionais = pontosFiltrados.filter(p => isItemEmocional(p) && !isItemSono(p));
    const pontosOutros = pontosFiltrados.filter(p => !isItemSono(p) && !isItemEmocional(p));
    const listaOrdenada = [...pontosSono, ...pontosEmocionais, ...pontosOutros].slice(0, 8);
    
    if (listaOrdenada.length > 0) {
      const listaHTML = listaOrdenada
        .map(p => {
          const destaque = isItemSono(p) ? 'style="color: #92400e; font-weight: 600;"' : 
                          isItemEmocional(p) ? 'style="color: #1e40af; font-weight: 600;"' : '';
          const emoji = isItemSono(p) ? '😴 ' : isItemEmocional(p) ? '💙 ' : '';
          return `<li ${destaque} style="margin-bottom:3px;font-size:11px;color:#334155">${emoji}${escapeHtml(p)}</li>`;
        })
        .join("");
      
      const temSono = pontosSono.length > 0;
      const temEmocional = pontosEmocionais.length > 0;
      const tituloDestaque = temSono 
        ? '⚠️ Pontos Críticos <span style="font-size:10px;color:#92400e;font-weight:400">(Sono em destaque)</span>' 
        : temEmocional
          ? '⚠️ Pontos Críticos <span style="font-size:10px;color:#1e40af;font-weight:400">(Emoções em destaque)</span>'
          : '⚠️ Pontos Críticos';
      
      blocks.push(
        criarBlocoHTML(`
          <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:6px">${tituloDestaque}</div>
          <ul style="margin:0;padding-left:18px;list-style-type:disc">${listaHTML}</ul>
        `, true)
      );
    }
  }

  // 🔥 4. TABELA DE EVOLUÇÃO
  if (data.item_scores && data.item_scores.length > 0) {
    const tabelaHTML = gerarTabelaEvolucao(data.item_scores, data.pacienteGenero);
    if (tabelaHTML) {
      blocks.push(criarBlocoHTML(tabelaHTML, true));
    }
    
    // 🔥 NOVO: Adicionar seção explicativa APÓS a tabela
    const explicacoesHTML = gerarSecaoExplicativa(data.item_scores);
    if (explicacoesHTML) {
      blocks.push(criarBlocoHTML(explicacoesHTML, true));
    }
  } else {
    blocks.push(
      criarBlocoHTML(`
      <div style="text-align: center; padding: 20px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 12px; border: 2px dashed #cbd5e1;">
        <div style="font-size: 24px; margin-bottom: 8px;">📊</div>
        <div style="font-size: 13px; font-weight: 700; color: #334155; margin-bottom: 6px;">Evolução dos Itens</div>
        <div style="font-size: 11px; color: #64748b; line-height: 1.5;">
          Para visualizar a evolução comparativa, é necessário ter pelo menos <b>2 exames com análise completa</b> deste paciente.
          <br/><br/>
          <span style="color: #0284c7; font-weight: 600;">✨ Próximo exame já incluirá:</span>
          <br/>• Comparativo automático de scores por item
          <br/>• Indicadores de melhora/estabilidade/piora
          <br/>• Badge de resumo da evolução
        </div>
      </div>
    `, true)
    );
  }

  // 🔥 5. COMPARATIVO
  const comparativoHTML = extrairComparativoHTML(data.comparacao);
  if (comparativoHTML) {
    blocks.push(criarBlocoHTML(comparativoHTML, true));
  }

  // 🔥 6. MAPA TÉCNICO + IMPACTO FITNESS — COM FILTRO E DEDUPLICAÇÃO
  if (data.diagnostico?.problemas && data.diagnostico.problemas.length > 0) {
    const problemasFiltrados = data.diagnostico.problemas
      .filter(p => filtrarPorGenero(p.item, data.pacienteGenero))
      .map(p => ({ ...p, item: normalizarNomeItem(p.item) }));
    
    // Agrupar e deduplicar
    const mapaUnico = new Map<string, typeof problemasFiltrados[0]>();
    for (const p of problemasFiltrados) {
      const chave = `${p.sistema}|${p.item.toLowerCase()}`;
      if (!mapaUnico.has(chave) || (p.score ?? 100) < (mapaUnico.get(chave)?.score ?? 100)) {
        mapaUnico.set(chave, p);
      }
    }
    const problemasUnicos = Array.from(mapaUnico.values());
    
    if (problemasUnicos.length > 0) {
      const grupos: Record<string, typeof problemasUnicos> = {};
      for (const item of problemasUnicos) {
        const sys = item.sistema || "Geral";
        if (!grupos[sys]) grupos[sys] = [];
        grupos[sys].push(item);
      }

      const categoriasOrdenadas = Object.entries(grupos).sort((a, b) => b[1].length - a[1].length);
      let isFirstBlock = true;
      const ITENS_POR_BLOCO = 10;

      for (const [sistema, itens] of categoriasOrdenadas) {
        for (let i = 0; i < itens.length; i += ITENS_POR_BLOCO) {
          const chunk = itens.slice(i, i + ITENS_POR_BLOCO);
          const impactosUnicos = [...new Set(chunk.map(it => it.impacto).filter(Boolean))];
          const sintomasStr = impactosUnicos.length > 0
            ? `<div style="font-size:10px;color:#64748b;margin:4px 0 6px 0"><b>Sintomas:</b> ${impactosUnicos.slice(0, 3).join("; ")}${impactosUnicos.length > 3 ? "..." : ""}</div>`
            : "";

          const fitnessMap: Record<string, Set<string>> = {};
          for (const it of chunk) {
            if (!it.impacto_fitness) continue;
            for (const [k, v] of Object.entries(it.impacto_fitness)) {
              if (!fitnessMap[k]) fitnessMap[k] = new Set();
              fitnessMap[k].add(String(v));
            }
          }
          const fitnessTags = Object.entries(fitnessMap).map(([k, v]) => {
            const emoji = { performance: '💪', hipertrofia: '🏋️', emagrecimento: '🔥', recuperacao: '🩹', humor: '🧠' }[k] || '📊';
            return `<span style="background:#f0f9ff;color:#0284c7;padding:2px 6px;border-radius:4px;font-size:9px;margin-right:4px;display:inline-block">${emoji} ${k}: ${[...v].slice(0, 2).join(", ")}${v.size > 2 ? "..." : ""}</span>`;
          }).join("");
          const fitnessStr = fitnessTags ? `<div style="margin-top:4px">${fitnessTags}</div>` : "";

          const nomesItens = [...new Set(chunk.map(it => it.item))].join(", ");
          const htmlItens = `
            <div style="font-weight:800;color:#0f172a;font-size:11px;margin-bottom:3px">${escapeHtml(sistema)}</div>
            <div style="font-size:10px;color:#475569;margin-bottom:4px">${escapeHtml(nomesItens)}</div>
            ${sintomasStr}
            ${fitnessStr}
          `;

          const titulo = isFirstBlock
            ? `<div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:8px">🔍 Mapa Técnico e Impacto Fitness</div>`
            : `<div style="font-size:10px;color:#64748b;margin-bottom:8px;font-style:italic">Mapa Técnico (continuação)</div>`;

          blocks.push(criarBlocoHTML(`${titulo}${htmlItens}`, true));
          isFirstBlock = false;
        }
      }
    }
  }

  // 🔥 7. PLANO TERAPÊUTICO — COM FILTRO DE GÊNERO
  if (data.plano_terapeutico?.terapias?.length) {
    const terapiasFiltradas = data.plano_terapeutico.terapias
      .filter(t => filtrarPorGenero(t.nome, data.pacienteGenero))
      .map(t => ({ ...t, nome: normalizarNomeItem(t.nome) }));
    
    if (terapiasFiltradas.length > 0) {
      const TERAPIAS_POR_BLOCO = 4;
      for (let i = 0; i < terapiasFiltradas.length; i += TERAPIAS_POR_BLOCO) {
        const chunk = terapiasFiltradas.slice(i, i + TERAPIAS_POR_BLOCO);
        const htmlTerapias = chunk.map((t) => `
          <div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px dashed #e2e8f0">
            <div style="font-weight:700;color:#0f172a;font-size:11px">${escapeHtml(t.nome)}</div>
            <div style="font-size:10px;color:#0284c7;margin:2px 0"><b>${escapeHtml(t.frequencia || "")}</b></div>
            <div style="color:#475569;font-size:10px">${escapeHtml(t.descricao || "")}</div>
            ${t.justificativa ? `<div style="font-size:9px;color:#64748b;margin-top:3px"><b>Por quê:</b> ${escapeHtml(t.justificativa)}</div>` : ""}
          </div>
        `).join("");

        const titulo = i === 0
          ? `<div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:8px">🌿 Plano Terapêutico</div>`
          : `<div style="font-size:10px;color:#64748b;margin-bottom:8px;font-style:italic">Plano Terapêutico (cont.)</div>`;

        blocks.push(criarBlocoHTML(`${titulo}${htmlTerapias}`, i < terapiasFiltradas.length - TERAPIAS_POR_BLOCO));
      }
    }
  }

  // 🔥 8. FREQUÊNCIA SOLFEGGIO + JUSTIFICATIVA — COM DESTAQUE PARA SONO/EMOÇÕES
  const temInsônia = data.pontos_criticos?.some(p => isItemSono(p)) || 
                     data.item_scores?.some(is => isItemSono(is.item) && is.score_atual < 50);
  const temEmocionalCritico = data.item_scores?.some(is => isItemEmocional(is.item) && is.score_atual < 50);
  
  const frequenciaTexto = data.frequencia_lunara && !/^[\s—\-–]+$/.test(data.frequencia_lunara)
    ? data.frequencia_lunara
    : temInsônia 
      ? "🌙 Recomendação para Sono: 432Hz (ancoramento) + 528Hz (reparo) antes de dormir. Evitar telas 1h antes. Chá de camomila ou melissa."
      : temEmocionalCritico
        ? "💙 Recomendação Emocional: 417Hz (liberação) + 639Hz (conexão) durante meditação. Journaling e respiração consciente."
        : "Recomendação: Utilizar frequências Solfeggio (ex: 432Hz harmonização, 528Hz reparação) durante a sessão.";

  let htmlFrequenciaEJustificativa = `
    <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:6px">🎵 Frequência para Sessão</div>
    <div style="color:#334155;margin-bottom:12px;background:#f8fafc;padding:10px;border-radius:6px;border-left:4px solid ${temInsônia ? '#f59e0b' : temEmocionalCritico ? '#3b82f6' : '#8b5cf6'};font-size:11px">
      ${escapeHtml(frequenciaTexto)}
    </div>
  `;

  if (data.justificativa && !/^[\s—\-–]+$/.test(data.justificativa)) {
    htmlFrequenciaEJustificativa += `
      <div style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:6px">📝 Justificativa</div>
      <div style="color:#475569;font-size:11px;white-space:pre-line">${escapeHtml(data.justificativa)}</div>
    `;
  }

  blocks.push(criarBlocoHTML(htmlFrequenciaEJustificativa));

  // 🔥 9. RODAPÉ
  blocks.push(
    criarBlocoHTML(`
      <div style="text-align:center;font-size:9px;color:#94a3b8;padding-top:8px;border-top:1px solid #e2e8f0">
        Gerado por QRMA + BioSync • Lunara Terapias - Saúde Integrativa • ${new Date().getFullYear()}
      </div>
    `)
  );

  // =======================================================================
  // RENDERIZAÇÃO FINAL
  // =======================================================================
  blocks.forEach((b) => container.appendChild(b));
  document.body.appendChild(container);

  try {
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    let currentY = MARGEM_PDF;

    for (const block of blocks) {
      const canvas = await renderizarBlocoParaCanvas(block, PDF_CANVAS_SCALE);
      currentY = adicionarBlocoAoPDF(pdf, canvas, currentY, pageWidth, pageHeight);
    }

    const safeFilename = data.clientName.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
    pdf.save(`biosync-${safeFilename || "relatorio"}-${formatDate(dataExibicao).replace(/\//g, "-")}.pdf`);

  } catch (error) {
    console.error("❌ Erro ao gerar PDF:", error);
    alert("Erro ao gerar o PDF. Tente novamente ou contate o suporte.");
  } finally {
    container.remove();
  }
}