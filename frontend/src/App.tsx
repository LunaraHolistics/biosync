import type { AiStructuredData } from "./services/api";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { gerarRelatorioPDF, type RelatorioData } from "./services/pdf";
import ComparativoExamesView from "./components/ComparativoExames";
import {
  listarExames,
  buscarExamesPorNome,
  contarExames,
  contarExamesMesAtual,
  listarExamesPorPaciente,
  listarTerapias,
  listarBaseAnaliseSaude,
  salvarAnaliseCurada,
  salvarItemScores,  // ← ADICIONAR
  type ExameRow,
  type TerapiaRow,
  type BaseAnaliseSaudeRow,
} from "./services/db";

import {
  gerarAnaliseCompleta,
  gerarComparativoInteligente,
  type AnaliseCompleta,
} from "./lib/motorSemantico";

// ==============================
// 🔥 CATEGORIAS PARA FILTRO
// ==============================
const CATEGORIAS_DISPONIVEIS = ['fitness', 'emotional', 'sono', 'imunidade', 'mental'] as const;

const PALAVRAS_CHAVE_POR_CATEGORIA: Record<string, string[]> = {
  fitness: ['fisico', 'fitness', 'performance', 'treino', 'musculo', 'forca', 'energia', 'metabolismo', 'peso', 'gordura', 'colesterol', 'viscosidade', 'circulacao', 'coracao', 'vascular', 'miocardio', 'perfusao', 'oxigenio', 'aerobico', 'fadiga', 'resistencia', 'capacidade', 'exercicio', 'atletico', 'cardio', 'respiratorio', 'pulmao', 'sangue', 'arteria', 'veia'],
  emotional: ['emocional', 'emotional', 'emocao', 'sentimento', 'ansiedade', 'depressao', 'medo', 'culpa', 'vergonha', 'raiva', 'tristeza', 'luto', 'apego', 'magoa', 'estresse', 'humor', 'instabilidade', 'afetivo', 'psicologico', 'trauma', 'frustracao', 'desanimo', 'apatia', 'melancolia', 'saudade', 'solidao', 'rejeicao', 'abandono'],
  sono: ['sono', 'insomnia', 'insonia', 'dormir', 'descanso', 'repouso', 'letargia', 'cansaco', 'exaustao', 'fadiga', 'acordar', 'noite', 'melatonina', 'despertar', 'ciclo', 'ritmo', 'circadiano', 'sonolencia', 'vigilia', 'cochilo'],
  imunidade: ['imunidade', 'imune', 'defesa', 'alergia', 'alergeno', 'inflamacao', 'infeccao', 'virus', 'bacteria', 'fungo', 'parasita', 'linfonodo', 'amigdala', 'bao', 'timo', 'imunoglobulina', 'respiratorio', 'gastrointestinal', 'mucosa', 'anticorpo', 'leucocito', 'linfocito', 'resistencia', 'protecao', 'vacina', 'imunizacao'],
  mental: ['mental', 'cognitivo', 'pensamento', 'memoria', 'concentracao', 'foco', 'razao', 'logica', 'aprendizado', 'nevoa', 'brain fog', 'confusao', 'clareza', 'neurologico', 'cerebro', 'cerebral', 'nervoso', 'sinapse', 'intelecto', 'raciocinio', 'julgamento', 'decisao', 'intuicao', 'percepcao', 'consciencia', 'mente']
};

// ==============================
// TIPOS LOCAIS
// ==============================

type DiagnosticoPdf = {
  problemas: {
    sistema: string;
    item: string;
    status: string;
    impacto: string;
    score?: number;
  }[];
};

type ItemScoreEvolucao = {
  item: string;
  categoria: string;
  score_atual: number;
  score_anterior: number | null;
  delta: number;
  trend: 'melhorou' | 'piorou' | 'estavel' | 'novo';
  impacto: string;
  impacto_fitness?: {
    performance?: string;
    hipertrofia?: string;
    emagrecimento?: string;
    recuperacao?: string;
    humor?: string;
  };
};

// ==============================
// HELPERS LEGADOS
// ==============================

function resultadoMeta(row: ExameRow): Record<string, unknown> {
  const r = row.resultado_json;
  return r && typeof r === "object" && !Array.isArray(r)
    ? (r as Record<string, unknown>)
    : {};
}

function toDiagnostico(value: unknown): DiagnosticoPdf | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as { problemas?: unknown };
  if (!Array.isArray(obj.problemas)) return undefined;

  const problemas = obj.problemas.filter(
    (p): p is DiagnosticoPdf["problemas"][number] => {
      if (!p || typeof p !== "object") return false;
      const item = p as Record<string, unknown>;
      return (
        typeof item.sistema === "string" &&
        typeof item.item === "string" &&
        typeof item.status === "string" &&
        typeof item.impacto === "string"
      );
    }
  );

  return { problemas };
}

function labelPlanoTipo(t: AiStructuredData["plano_terapeutico"]["tipo"]): string {
  if (t === "semanal") return "Semanal";
  if (t === "quinzenal") return "Quinzenal";
  return "Mensal";
}

const COMPARATIVO_VAZIO = {
  melhoraram: [],
  pioraram: [],
  novos_problemas: [],
  normalizados: [],
};

// ==============================
// HELPER: FILTRAR TERAPIAS OCULTAS NO PDF
// ==============================
function getDataParaPdf(data: RelatorioData, ocultas: Set<string>): RelatorioData {
  if (ocultas.size === 0) return data;
  return {
    ...data,
    plano_terapeutico: data.plano_terapeutico
      ? {
        ...data.plano_terapeutico,
        terapias: data.plano_terapeutico.terapias.filter((_, i) => !ocultas.has(String(i))),
      }
      : undefined,
  };
}

// ==============================
// 🔥 FUNÇÃO DE FILTRO POR CATEGORIA (EVOLUÍDA)
// =======================================================================
// Melhorias:
// - Match de categoria case-insensitive e por substring (evita perda por variação de casing)
// - Regex de títulos mais flexível (captura qualquer título em MAIÚSCULAS, não apenas os hardcoded)
// - Fallback para manter seções com palavras-chave mesmo sem título reconhecido
// =======================================================================
function filtrarAnalisePorCategoria(analise: AnaliseCompleta, categoriasFiltro: string[]): AnaliseCompleta {
  if (categoriasFiltro.length === 0) return analise;

  // Normalizar categorias do filtro para busca flexível
  const filtroNorm = categoriasFiltro.map(c => c.toLowerCase());

  const palavrasChaveAtivas = new Set<string>();
  for (const cat of categoriasFiltro) {
    palavrasChaveAtivas.add(cat.toLowerCase());
    const palavras = PALAVRAS_CHAVE_POR_CATEGORIA[cat] || [];
    palavras.forEach(p => palavrasChaveAtivas.add(p.toLowerCase()));
  }

  // =======================================================================
  // FILTRAR INTERPRETAÇÃO (SEÇÕES)
  // =======================================================================
  let interpretacaoFiltrada = analise.interpretacao;
  if (categoriasFiltro.length > 0 && analise.interpretacao) {
    // Extrair introdução (tudo antes do primeiro título em MAIÚSCULAS)
    const introMatch = analise.interpretacao.match(/^([\s\S]*?)(?=\b(?:[A-ZÀ-Ú]{4,}(?:\s+[A-ZÀ-Ú]+)*)\b)/);
    const intro = introMatch?.[1]?.trim() || '';

    // Regex flexível: captura qualquer título que seja 4+ letras MAIÚSCULAS
    // (Não depende mais de lista hardcoded de nomes de seção)
    const regexTitulos = /(?=\b(?:[A-ZÀ-Ú]{4,}(?:\s+[A-ZÀ-Ú]+)*)\b)/;

    const secoesRaw = analise.interpretacao.split(regexTitulos);

    const secoesFiltradas = secoesRaw.filter(secao => {
      if (!secao.trim()) return false;
      const textoLower = secao.toLowerCase();

      // Verifica se ALGUMA palavra-chave ativa aparece no texto da seção
      const temKeywordAtiva = [...palavrasChaveAtivas].some(kw =>
        kw.length > 2 && textoLower.includes(kw)
      );

      if (temKeywordAtiva) return true;

      // Fallback: verifica se o título da seção contém alguma categoria
      const tituloMatch = secao.match(/^\b([A-ZÀ-Ú][A-ZÀ-Ú\s]+)\b/);
      const titulo = tituloMatch?.[1]?.trim() || '';
      if (!titulo) return false;

      return filtroNorm.some(cat => titulo.toLowerCase().includes(cat));
    });

    const conclusaoMatch = analise.interpretacao.match(/(Conclus[aã]o[\s\S]*$)/i);
    const conclusao = conclusaoMatch?.[1]?.trim() || '';

    const partes = [];
    if (intro) partes.push(intro);
    if (secoesFiltradas.length > 0) partes.push(...secoesFiltradas);
    if (conclusao) partes.push(conclusao);

    interpretacaoFiltrada = partes.join('\n\n').trim() || analise.interpretacao;
  }

  // =======================================================================
  // FILTRAR PONTOS CRÍTICOS
  // =======================================================================
  const pontosCriticosFiltrados = analise.pontosCriticos.filter((p: string) => {
    const itemMatch = p.match(/^·?\s*([^:：]+):/);
    const item = itemMatch?.[1]?.trim() || p;
    const textoLower = p.toLowerCase();
    const itemLower = item.toLowerCase();

    return filtroNorm.some(cat => {
      const palavras = PALAVRAS_CHAVE_POR_CATEGORIA[cat] || [];
      return itemLower.includes(cat) ||
        palavras.some(palavra => textoLower.includes(palavra) || itemLower.includes(palavra));
    });
  });

  // =======================================================================
  // FILTRAR MATCHES (case-insensitive + substring)
  // =======================================================================
  const matchesFiltrados = analise.matches.filter((m: any) => {
    const catNorm = (m.categoria || '').toLowerCase();
    // Match exato OU substring (ex: "sistema nervoso" inclui "nervoso")
    return filtroNorm.some(f => catNorm.includes(f) || f.includes(catNorm));
  });

  // =======================================================================
  // FILTRAR TERAPIAS (tags case-insensitive)
  // =======================================================================
  const terapiasFiltradas = analise.terapias.filter((t: any) => {
    const tags = [t.categoria, ...(t.tags || [])].filter(Boolean).map((tag: string) => tag.toLowerCase());
    return tags.some((tag: string) =>
      filtroNorm.some(f => tag.includes(f) || f.includes(tag))
    );
  });

  // =======================================================================
  // FILTRAR SETORES (case-insensitive + substring)
  // =======================================================================
  const setoresFiltrados = analise.setoresAfetados.filter((s: string) => {
    const sNorm = s.toLowerCase();
    return filtroNorm.some(f => sNorm.includes(f) || f.includes(sNorm));
  });

  return {
    ...analise,
    interpretacao: interpretacaoFiltrada,
    pontosCriticos: pontosCriticosFiltrados.length > 0
      ? pontosCriticosFiltrados
      : ['Nenhum ponto crítico identificado para as categorias selecionadas.'],
    matches: matchesFiltrados,
    terapias: terapiasFiltradas,
    setoresAfetados: setoresFiltrados
  };
}

// ==============================
// 🔥 DETECÇÃO DE SCORES GENÉRICOS
// =======================================================================

/**
 * Detecta se um array de scores é "genérico" (todos iguais ou sem variação real).
 * Scores genéricos indicam que a fonte não tem dados reais — deve ser rejeitada.
 */
function ScoresSaoGenericos(scores: ItemScoreEvolucao[]): boolean {
  if (!scores || scores.length === 0) return true;
  if (scores.length === 1) return false;

  const valoresUnicos = new Set(scores.map(s => s.score_atual));

  // Se TODOS os scores são iguais → genérico
  if (valoresUnicos.size === 1) {
    const valorUnico = [...valoresUnicos][0];
    console.warn(`⚠️ [SCORES GENÉRICOS] Todos os ${scores.length} itens têm score ${valorUnico} — fonte será rejeitada`);
    return true;
  }

  // Se 90%+ dos scores são o mesmo valor → suspeito
  const contagemPorValor = new Map<number, number>();
  for (const s of scores) {
    contagemPorValor.set(s.score_atual, (contagemPorValor.get(s.score_atual) || 0) + 1);
  }
  const maxContagem = Math.max(...contagemPorValor.values());
  if (maxContagem / scores.length >= 0.9) {
    const valorDominante = [...contagemPorValor.entries()].find(([_, c]) => c === maxContagem)?.[0];
    console.warn(`⚠️ [SCORES SUSPEITOS] ${maxContagem}/${scores.length} itens têm score ${valorDominante} — fonte será rejeitada`);
    return true;
  }

  return false;
}

// ==============================
// 🔥 EXTRAIR SCORES DOS PONTOS CRÍTICOS (FONTE ALTERNATIVA)
// =======================================================================

/**
 * Tenta extrair scores numéricos dos pontos_criticos do exame.
 * Padrões reconhecidos: "Magnésio: 35", "Sistema Nervoso — 42", "Insônia (28)"
 */
function extrairScoresDosPontosCriticos(pontosCriticos: string[]): Map<string, number> {
  const map = new Map<string, number>();

  for (const p of pontosCriticos) {
    let match = p.match(/^·?\s*(.+?)\s*[:：]\s*(\d{1,3})\s*$/);
    if (!match) {
      match = p.match(/^·?\s*(.+?)\s*[—\-–]\s*(\d{1,3})\s*$/);
    }
    if (!match) {
      match = p.match(/^·?\s*(.+?)\s*[(（]\s*(\d{1,3})\s*[)）]\s*$/);
    }

    if (match) {
      const item = match[1].trim().replace(/^·\s*/, '').toLowerCase();
      const score = parseInt(match[2], 10);
      if (score >= 0 && score <= 100) {
        map.set(item, score);
      }
    }
  }

  return map;
}

// ==============================
// 🔥 CÁLCULO DE EVOLUÇÃO ENTRE EXAMES
// =======================================================================

function calcularTendenciaItem(scoreAtual: number, scoreAnterior: number | null): 'melhorou' | 'piorou' | 'estavel' | 'novo' {
  if (scoreAnterior === null) return 'novo';
  const delta = scoreAtual - scoreAnterior;
  if (delta >= 10) return 'melhorou';
  if (delta <= -10) return 'piorou';
  return 'estavel';
}

function extrairScoresExameAnterior(
  examesAnteriores: ExameRow[],
  dataExameAtual?: string | Date,
  idExameAtual?: string
): Map<string, ItemScoreEvolucao> {
  const mapa = new Map<string, ItemScoreEvolucao>();

  if (!examesAnteriores || examesAnteriores.length === 0) return mapa;

  function parseDataLocal(valor: string | Date): number {
    if (valor instanceof Date) return valor.getTime();
    const str = String(valor).split('T')[0];
    const partes = str.split('-');
    if (partes.length === 3 && partes[0].length === 4) {
      return new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2])).getTime();
    }
    return new Date(valor).getTime();
  }

  const dataAtualMs = dataExameAtual ? parseDataLocal(dataExameAtual) : Infinity;

  const anterior = examesAnteriores
    .filter(e => {
      if (idExameAtual && e.id === idExameAtual) return false;
      const dataExameMs = parseDataLocal(e.data_exame || e.created_at);
      if (dataExameMs === dataAtualMs) {
        return new Date(e.created_at).getTime() < Date.now();
      }
      return dataExameMs < dataAtualMs;
    })
    .sort((a, b) =>
      parseDataLocal(b.data_exame || b.created_at) -
      parseDataLocal(a.data_exame || a.created_at)
    )[0];

  if (!anterior) return mapa;

  const ib = anterior.indice_biosync;
  if (ib && typeof ib === 'object' && 'item_scores' in ib && Array.isArray((ib as any).item_scores) && (ib as any).item_scores.length > 0) {
    for (const item of (ib as any).item_scores as ItemScoreEvolucao[]) {
      const chave = (item.item || '').trim().replace(/[:：]$/, '').toLowerCase();
      if (chave && typeof item.score_atual === 'number') {
        mapa.set(chave, item);
      }
    }
    console.log(`📊 [EVOLUÇÃO] ${mapa.size} scores do exame ${anterior.data_exame} (${anterior.id.substring(0, 6)})`);
  }

  return mapa;
}

// ==============================
// 🔥 HELPER: EXTRAIR SCORES DO EXAME ANTERIOR (VERSÃO COMPLETA)
// =======================================================================

function extrairScoresExameAnteriorCompleto(
  examesAnteriores: ExameRow[],
  dataExameAtual?: string | Date,
  idExameAtual?: string,
  base?: BaseAnaliseSaudeRow[],
  terapias?: TerapiaRow[]
): Map<string, ItemScoreEvolucao> {
  const mapa = new Map<string, ItemScoreEvolucao>();

  if (!examesAnteriores || examesAnteriores.length === 0) return mapa;

  function parseDataLocal(valor: string | Date): number {
    if (valor instanceof Date) return valor.getTime();
    const str = String(valor).split('T')[0];
    const partes = str.split('-');
    if (partes.length === 3 && partes[0].length === 4) {
      return new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2])).getTime();
    }
    return new Date(valor).getTime();
  }

  const dataAtualMs = dataExameAtual ? parseDataLocal(dataExameAtual) : Infinity;

  const anterioresValidos = examesAnteriores.filter(e => {
    if (idExameAtual && e.id === idExameAtual) return false;
    const dataExameMs = parseDataLocal(e.data_exame || e.created_at);
    if (dataExameMs === dataAtualMs) {
      return new Date(e.created_at).getTime() < Date.now();
    }
    return dataExameMs < dataAtualMs;
  });

  // Ordena do mais recente para o mais antigo
  anterioresValidos.sort((a, b) =>
    parseDataLocal(b.data_exame || b.created_at) -
    parseDataLocal(a.data_exame || a.created_at)
  );

  const anterior = anterioresValidos[0];

  console.log(`🔍 [EVOLUÇÃO] Exame selecionado como anterior:`);
  console.log(`   ID: ${anterior.id.substring(0, 6)}`);
  console.log(`   Data: ${anterior.data_exame}`);
  console.log(`   Created: ${anterior.created_at?.substring(0, 16)}`);
  console.log(`   Tem item_scores: ${!!(anterior.indice_biosync as any)?.item_scores}`);

  // =======================================================================
  // TENTATIVA 1: Buscar indice_biosync.item_scores
  // =======================================================================
  const ib = anterior.indice_biosync;
  if (ib && typeof ib === 'object' && 'item_scores' in ib && Array.isArray((ib as any).item_scores) && (ib as any).item_scores.length > 0) {
    const items = (ib as any).item_scores as ItemScoreEvolucao[];

    // ✅ VERIFICAÇÃO: amostra dos scores para log
    console.log(`📊 [EVOLUÇÃO] Scores do anterior (5 primeiros):`);
    items.slice(0, 5).forEach(item => {
      console.log(`   → "${item.item}": ${item.score_atual}`);
    });

    for (const item of items) {
      const chave = (item.item || '').trim().replace(/[:：]$/, '').toLowerCase();
      if (chave && typeof item.score_atual === 'number') {
        mapa.set(chave, item);
      }
    }

    if (mapa.size > 0) {
      console.log(`✅ [EVOLUÇÃO] Encontrados ${mapa.size} scores no banco`);
      return mapa;
    }
  }

  // =======================================================================
  // TENTATIVA 2: Rodar o motor (FALLBACK)
  // =======================================================================
  if (base && terapias && base.length > 0) {
    console.log(`🔄 [EVOLUÇÃO] Rodando motor no exame anterior...`);

    try {
      const analiseAnterior = gerarAnaliseCompleta(anterior, base, terapias);

      if (analiseAnterior.matches && analiseAnterior.matches.length > 0) {
        // ✅ VERIFICAÇÃO: amostra dos scores gerados
        console.log(`📊 [EVOLUÇÃO] Scores gerados pelo motor (5 primeiros):`);
        analiseAnterior.matches.slice(0, 5).forEach(m => {
          console.log(`   → "${m.itemBase}": ${m.score}`);
        });

        for (const m of analiseAnterior.matches) {
          if (m.itemBase && typeof m.score === 'number') {
            const chave = m.itemBase.trim().replace(/[:：]$/, '').toLowerCase();
            mapa.set(chave, {
              item: m.itemBase,
              categoria: m.categoria || 'geral',
              score_atual: m.score,
              score_anterior: null,
              delta: 0,
              trend: 'novo',
              impacto: m.impacto || ''
            });
          }
        }

        if (mapa.size > 0) {
          console.log(`✅ [EVOLUÇÃO] Motor gerou ${mapa.size} scores`);
        }
      }
    } catch (e) {
      console.warn('⚠️ [EVOLUÇÃO] Falha no motor:', e);
    }
  } else {
    console.warn(`⚠️ [EVOLUÇÃO] Sem dados para fallback (base=${base?.length ?? 0}, terapias=${terapias?.length ?? 0})`);
  }

  return mapa;
}

// ==============================
// 🔥 HELPER: EXTRAIR GÊNERO DO PACIENTE
// ==============================
function extrairGeneroPaciente(nomePaciente: string): 'masculino' | 'feminino' | undefined {
  if (!nomePaciente) return undefined;
  const match = nomePaciente.match(/Sexo:\s*(Masculino|Feminino)/i);
  if (!match) return undefined;
  return match[1].toLowerCase() as 'masculino' | 'feminino';
}

// ==============================
// SEÇÃO PLANO TERAPÊUTICO
// ==============================

function SecaoPlanoTerapeutico({ data, editavel, onChangeEditavel, ocultas, onToggleOculta }: {
  data: AiStructuredData;
  editavel?: string;
  onChangeEditavel?: (v: string) => void;
  ocultas?: Set<string>;
  onToggleOculta?: (idx: string) => void;
}) {
  const p = data.plano_terapeutico;

  if (!p?.terapias?.length && !editavel) {
    return (
      <div>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>PLANO TERAPÊUTICO</div>
        <div style={{ opacity: 0.8 }}>Nenhuma terapia sugerida automaticamente.</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontWeight: 900, marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>🌿 PLANO TERAPÊUTICO</span>
        {ocultas && ocultas.size > 0 && (
          <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 400, background: "rgba(245, 158, 11, 0.1)", padding: "2px 8px", borderRadius: 4 }}>
            {ocultas.size} ocultada(s)
          </span>
        )}
      </div>

      {p.terapias.length > 0 && (
        <>
          <div style={{ marginBottom: 10, fontSize: 13, color: "#64748b" }}>
            <b>Periodicidade:</b> {labelPlanoTipo(p.tipo)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {p.terapias.map((item: any, i: number) => {
              const idx = String(i);
              const isOculta = ocultas?.has(idx) || false;

              if (isOculta) {
                return (
                  <div
                    key={i}
                    onClick={() => onToggleOculta?.(idx)}
                    style={{
                      display: "flex", gap: 10,
                      border: "1px dashed #475569", borderRadius: 10, padding: 10,
                      opacity: 0.6, cursor: "pointer", transition: "all 0.2s",
                      background: "rgba(71, 85, 105, 0.05)"
                    }}
                    title="Clique para restaurar esta terapia ao PDF"
                  >
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", paddingTop: 2 }}>
                      <input type="checkbox" checked={true} readOnly
                        style={{ cursor: "pointer", accentColor: "#22c55e", width: 16, height: 16 }} />
                      <span style={{ fontSize: 8, opacity: 1, marginTop: 2, color: "#22c55e", fontWeight: 700 }}>✓</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, textDecoration: "line-through", color: "#94a3b8" }}>{item.nome}</div>
                      <div style={{ fontSize: 10, color: "#64748b" }}>Ocultada do PDF • Clique para restaurar</div>
                    </div>
                  </div>
                );
              }

              return (
                <div key={i} style={{
                  display: "flex", gap: 10,
                  border: "1px solid var(--border)", borderRadius: 10, padding: 12,
                  background: "rgba(255,255,255,0.02)", transition: "border-color 0.2s"
                }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", paddingTop: 2 }}>
                    <input type="checkbox" checked={false} onChange={() => onToggleOculta?.(idx)}
                      style={{ cursor: "pointer", accentColor: "#ef4444", width: 16, height: 16 }}
                      title="Clique para ocultar esta terapia do PDF" />
                    <span style={{ fontSize: 8, opacity: 0.6, marginTop: 2, color: "#ef4444" }}>Ocultar</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 13 }}>{item.nome}</div>
                    <div style={{ fontSize: 12, color: "#0ea5e9", marginBottom: 4 }}>
                      <b>Frequência:</b> {item.frequencia || "Conforme necessidade"}
                    </div>
                    <div style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 6, whiteSpace: "pre-wrap" }}>
                      {item.descricao || "—"}
                    </div>
                    {item.justificativa && (
                      <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic", borderLeft: "2px solid #334155", paddingLeft: 8 }}>
                        <b>Por quê:</b> {item.justificativa}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {onChangeEditavel && (
        <div style={{ marginTop: 16, padding: 12, background: "rgba(30, 41, 59, 0.5)", borderRadius: 10, border: "1px dashed #475569" }}>
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 12, color: "#94a3b8" }}>
            ✏️ Adicionar terapias manualmente:
          </div>
          <textarea
            value={editavel}
            onChange={(e) => onChangeEditavel(e.target.value)}
            placeholder="Formato: Nome da Terapia — Frequência — Descrição/Justificativa

Exemplos:
• Acupuntura — Semanal — Para dor e inflamação crônica
• Ozonioterapia — Quinzenal — Para oxigenação tecidual
• Fitoterapia — Diário — Suporte hepático e desintox"
            style={{
              width: "100%", minHeight: 100, padding: 10, borderRadius: 8,
              border: "1px solid var(--border)", background: "rgba(15, 23, 42, 0.5)",
              color: "inherit", fontSize: 12, lineHeight: "18px",
              resize: "vertical", boxSizing: "border-box", fontFamily: "monospace"
            }}
          />
        </div>
      )}
    </div>
  );
}

// ==============================
// 🔥 CONVERSÃO: Motor Novo → AiStructuredData
// ==============================

function exameRowToAiData(
  row: ExameRow,
  base: BaseAnaliseSaudeRow[],
  terapias: TerapiaRow[],
  terapiasManuais?: string,
  filtrosAtivos?: string[]
): { data: AiStructuredData; pacienteGenero?: 'masculino' | 'feminino' } {
  const analiseRaw = gerarAnaliseCompleta(row, base, terapias);

  const analise = filtrosAtivos?.length
    ? filtrarAnalisePorCategoria(analiseRaw, filtrosAtivos)
    : analiseRaw;

  const terapiasFormatadas = analise.terapias.map((t: any) => ({
    nome: t.nome,
    frequencia: (t as any).frequencia || t.frequencia_recomendada || "Conforme necessidade",
    descricao: t.descricao || t.indicacoes || "",
    justificativa: t.motivos?.length
      ? `Setores: ${t.motivos.join(", ")}. ${t.indicacoes || ""}`
      : t.indicacoes || "",
  }));

  if (terapiasManuais && terapiasManuais.trim()) {
    const linhas = terapiasManuais.split("\n").filter((l) => l.trim().length > 0);
    for (const linha of linhas) {
      const partes = linha.split("—").map((s) => s.trim());
      terapiasFormatadas.push({
        nome: partes[0] || "Terapia",
        frequencia: partes[1] || "",
        descricao: partes.slice(2).join(" — ") || "",
        justificativa: "Adicionada manualmente pelo profissional.",
      });
    }
  }

  const frequencia_lunara = analise.frequencia_lunara || "";

  const setoresParaJustificativa = filtrosAtivos?.length && filtrosAtivos.length > 0
    ? analise.setoresAfetados.filter(s => filtrosAtivos.includes(s.toLowerCase()))
    : analise.setoresAfetados;

  const pacienteGenero = extrairGeneroPaciente(row.nome_paciente);

  const analiseData: AiStructuredData = {
    interpretacao: analise.interpretacao,
    pontos_criticos: analise.pontosCriticos,
    plano_terapeutico: {
      tipo: "mensal" as const,
      terapias: terapiasFormatadas,
    },
    frequencia_lunara: frequencia_lunara,
    justificativa: `Score: ${analise.scoreGeral}/100 — ${analise.statusScore}. Setores: ${setoresParaJustificativa.join(", ") || "nenhum"}.`,
  };

  return { data: analiseData, pacienteGenero };
}

// ==============================
// 🔥 FUNÇÃO buildRelatorioData — VERSÃO AUTO-SUFICIENTE
// =======================================================================
// Busca base/terapias automaticamente quando não são passados.
// Assim NENHUMA chamada pode esquecer os parâmetros.
// =======================================================================
async function buildRelatorioData(
  row: ExameRow,
  paciente: string,
  data: AiStructuredData,
  comparacao?: any,
  motor?: AnaliseCompleta,
  filtrosAtivos?: string[],
  examesAnteriores?: ExameRow[],
  pacienteGenero?: 'masculino' | 'feminino',
  baseAnaliseIn?: BaseAnaliseSaudeRow[],
  terapiasIn?: TerapiaRow[]
): Promise<RelatorioData> {
  const meta = resultadoMeta(row);

  // ✅ AUTO-SUFICIENTE: busca base e terapias se não foram passados
  let baseAnalise = baseAnaliseIn;
  let terapias = terapiasIn;

  if (!baseAnalise?.length || !terapias?.length) {
    console.log(`🔄 [AUTO] Buscando base/terapias automaticamente (base=${baseAnalise?.length || 0}, terapias=${terapias?.length || 0})`);
    try {
      const [baseData, terapiasData] = await Promise.all([
        baseAnalise?.length ? Promise.resolve(baseAnalise) : listarBaseAnaliseSaude(),
        terapias?.length ? Promise.resolve(terapias) : listarTerapias()
      ]);
      baseAnalise = baseData;
      terapias = terapiasData;
      console.log(`✅ [AUTO] Obtidos: base=${baseAnalise.length} itens, terapias=${terapias.length} itens`);
    } catch (e) {
      console.warn('⚠️ [AUTO] Falha ao buscar base/terapias:', e);
    }
  }

  let itemScoresEvolucao: ItemScoreEvolucao[] = [];
  let fonteUsada = 'nenhuma';

  // =======================================================================
  // FONTE 1: motor.matches (cálculo fresco — PRIORIDADE MÁXIMA)
  // =======================================================================
  if (motor?.matches && motor.matches.length > 0) {
    const scoresDoMotor: ItemScoreEvolucao[] = motor.matches
      .filter((m: any) => m.itemBase && typeof m.score === 'number')
      .map((m: any) => ({
        item: m.itemBase,
        categoria: m.categoria || 'geral',
        score_atual: m.score as number,
        score_anterior: null,
        delta: 0,
        trend: 'novo' as const,
        impacto: m.impacto || 'Desequilíbrio bioenergético identificado',
        impacto_fitness: (m as any).impacto_fitness || undefined,
      }));

    if (!ScoresSaoGenericos(scoresDoMotor) && scoresDoMotor.length > 0) {
      itemScoresEvolucao = scoresDoMotor;
      fonteUsada = 'motor.matches';
      console.log(`✅ [SCORES] Fonte: motor.matches — ${scoresDoMotor.length} itens`);
    } else {
      console.warn('⚠️ [SCORES] motor.matches rejeitado — scores genéricos');
    }
  }

  // =======================================================================
  // FONTE 2: pontos_criticos com regex
  // =======================================================================
  if (itemScoresEvolucao.length === 0 && data.pontos_criticos?.length > 0) {
    const scoresDoTexto = extrairScoresDosPontosCriticos(data.pontos_criticos);

    if (scoresDoTexto.size > 0) {
      const valoresUnicos = new Set(scoresDoTexto.values());
      if (valoresUnicos.size > 1) {
        itemScoresEvolucao = Array.from(scoresDoTexto.entries()).map(([item, score]) => ({
          item: item.replace(/^./, c => c.toUpperCase()),
          categoria: 'geral',
          score_atual: score,
          score_anterior: null,
          delta: 0,
          trend: 'novo' as const,
          impacto: 'Desequilíbrio identificado nos pontos críticos',
        }));
        fonteUsada = 'pontos_criticos (regex)';
        console.log(`✅ [SCORES] Fonte: pontos_criticos — ${itemScoresEvolucao.length} itens`);
      }
    }
  }

  // =======================================================================
  // FONTE 3: indice_biosync do banco
  // =======================================================================
  if (itemScoresEvolucao.length === 0 && row.indice_biosync && typeof row.indice_biosync === 'object') {
    const biosync = row.indice_biosync as Record<string, any>;

    if (Array.isArray(biosync.item_scores) && biosync.item_scores.length > 0) {
      const scoresDoBanco: ItemScoreEvolucao[] = biosync.item_scores
        .filter((is: any) => is.item && typeof is.score_atual === 'number')
        .map((is: any) => ({
          item: is.item,
          categoria: is.categoria || 'geral',
          score_atual: is.score_atual as number,
          score_anterior: typeof is.score_anterior === 'number' ? is.score_anterior : null,
          delta: is.delta ?? 0,
          trend: is.trend ?? 'novo',
          impacto: is.impacto || 'Desequilíbrio bioenergético identificado',
          impacto_fitness: is.impacto_fitness || undefined,
        }));

      if (!ScoresSaoGenericos(scoresDoBanco) && scoresDoBanco.length > 0) {
        itemScoresEvolucao = scoresDoBanco;
        fonteUsada = 'indice_biosync (banco)';
        console.log(`✅ [SCORES] Fonte: indice_biosync — ${scoresDoBanco.length} itens`);
      }
    }
  }

  // =======================================================================
  // FALLBACK FINAL
  // =======================================================================
  if (itemScoresEvolucao.length === 0) {
    console.error('❌ [SCORES] NENHUMA fonte com scores válidos!');
  }

  // =======================================================================
  // EVOLUÇÃO: preencher score_anterior ou marcar como primeiro exame
  // =======================================================================
  let avisoComparacao: string | undefined;

  if (itemScoresEvolucao.length > 0 && examesAnteriores && examesAnteriores.length > 0) {
    const mapaAnterior = extrairScoresExameAnterior(
      examesAnteriores,
      row.data_exame || row.created_at,
      row.id
    );

    if (mapaAnterior.size > 0) {
      let preenchidos = 0;
      itemScoresEvolucao = itemScoresEvolucao.map(item => {
        const chave = item.item.trim().replace(/[:：]$/, '').toLowerCase();
        const anterior = mapaAnterior.get(chave);
        if (anterior) {
          preenchidos++;
          const delta = item.score_atual - anterior.score_atual;
          return {
            ...item,
            score_anterior: anterior.score_atual,
            delta,
            trend: calcularTendenciaItem(item.score_atual, anterior.score_atual),
          };
        }
        return item;
      });
      console.log(`📊 [EVOLUÇÃO] ${preenchidos}/${itemScoresEvolucao.length} itens com anterior`);
    } else {
      avisoComparacao = "Primeiro exame deste paciente disponível para comparação. Os scores atuais foram salvos — no próximo exame, a tabela de evolução será gerada automaticamente.";
    }
  } else if (itemScoresEvolucao.length > 0) {
    avisoComparacao = "Primeiro exame deste paciente disponível para comparação. Os scores atuais foram salvos — no próximo exame, a tabela de evolução será gerada automaticamente.";
  }

  // =======================================================================
  // ✅ PERSISTIR scores no Supabase para futuras comparações
  // =======================================================================
  if (itemScoresEvolucao.length > 0 && fonteUsada === 'motor.matches') {
    salvarItemScores(row.id, itemScoresEvolucao).catch(() => {});
  }

  // =======================================================================
  // LOG RESUMO FINAL
  // =======================================================================
  if (itemScoresEvolucao.length > 0) {
    const scores = itemScoresEvolucao.map(i => i.score_atual);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const media = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    const unicos = new Set(scores).size;
    console.log(`📊 [RESUMO] Fonte: ${fonteUsada} | Itens: ${itemScoresEvolucao.length} | Min: ${min} | Max: ${max} | Média: ${media} | Únicos: ${unicos}`);
  }

  return {
    clientName: paciente || "Cliente",
    createdAt: new Date(row.data_exame || row.created_at),
    interpretacao: data.interpretacao || "",
    pontos_criticos: data.pontos_criticos ?? [],
    plano_terapeutico: data.plano_terapeutico,
    frequencia_lunara: data.frequencia_lunara || "",
    justificativa: avisoComparacao
      ? `${data.justificativa || ""}\n\n⚠️ ${avisoComparacao}`
      : (data.justificativa || ""),
    diagnostico: motor ? {
      problemas: motor.matches.map((m: any) => ({
        sistema: m.categoria,
        item: m.itemBase,
        status: m.gravidade,
        impacto: m.impacto,
        impacto_fitness: (m as any).impacto_fitness || undefined,
      }))
    } : toDiagnostico(meta.diagnostico),
    comparacao,
    relatorio_original_html: getRelatorioOriginal(meta, row),
    filtros_aplicados: filtrosAtivos && filtrosAtivos.length > 0 ? filtrosAtivos : undefined,
    item_scores: itemScoresEvolucao.length > 0 ? itemScoresEvolucao : undefined,
    pacienteGenero
  };
}

function getRelatorioOriginal(
  meta: Record<string, unknown>,
  _row: ExameRow
): string | undefined {
  if (meta && typeof meta === "object" && "relatorio_original_html" in meta) {
    const val = (meta as any).relatorio_original_html;
    if (typeof val === "string" && val.length > 0) return val;
  }
  return undefined;
}

// ==============================
// APP
// ==============================

function App() {
  const [clientName, setClientName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingAnalysisId, setExistingAnalysisId] = useState<string | null>(null);
  const analysisRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [todosExames, setTodosExames] = useState<ExameRow[]>([]);
  const [buscaPacientes, setBuscaPacientes] = useState("");
  const [pacienteSelecionado, setPacienteSelecionado] = useState<string | null>(null);
  const [analiseSelecionada, setAnaliseSelecionada] = useState<ExameRow | null>(null);
  const [examesPaciente, setExamesPaciente] = useState<ExameRow[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [baseAnalise, setBaseAnalise] = useState<BaseAnaliseSaudeRow[]>([]);
  const [terapias, setTerapias] = useState<TerapiaRow[]>([]);
  const [categoriasFiltro, setCategoriasFiltro] = useState<string[]>([]);
  const todasCategoriasSelecionadas = categoriasFiltro.length === 0;
  const [cacheAnalise, setCacheAnalise] = useState<Record<string, AnaliseCompleta>>({});
  const [terapiasEditavel, setTerapiasEditavel] = useState("");
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [terapiasOcultas, setTerapiasOcultas] = useState<Set<string>>(new Set());

  const toggleCategoria = (cat: string) => {
    setCategoriasFiltro(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  };

  const estaSelecionado = (cat: string) => todasCategoriasSelecionadas || categoriasFiltro.includes(cat);

  const [dashboard, setDashboard] = useState({
    totalExames: 0,
    examesMesAtual: 0,
  });

  const nomesPacientes = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of todosExames) {
      const n = e.nome_paciente?.trim();
      if (n) map.set(n, n);
    }
    return Array.from(map.keys()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [todosExames]);

  function obterAnalise(row: ExameRow): AnaliseCompleta {
    if (cacheAnalise[row.id]) return cacheAnalise[row.id];
    const analise = gerarAnaliseCompleta(row, baseAnalise, terapias);
    salvarAnaliseCurada(row.id, analise).then((sucesso) => {
      if (sucesso) console.log(`✅ Análise curada salva: ${row.id.substring(0, 5)}`);
    });
    setCacheAnalise((prev) => ({ ...prev, [row.id]: analise }));
    return analise;
  }

  const comparativoExamesData = useMemo(() => {
    if (examesPaciente.length < 2) return null;
    const ordenados = [...examesPaciente].sort(
      (a, b) =>
        new Date(b.data_exame || b.created_at).getTime() -
        new Date(a.data_exame || a.created_at).getTime()
    );
    return gerarComparativoInteligente(ordenados);
  }, [examesPaciente]);

  const analiseResult = analiseSelecionada
    ? exameRowToAiData(analiseSelecionada, baseAnalise, terapias, terapiasEditavel, categoriasFiltro)
    : { data: null, pacienteGenero: undefined };

  const analiseSelecionadaData = analiseResult.data;
  const generoSelecionado = analiseResult.pacienteGenero;

  const analiseMotorRaw = analiseSelecionada
    ? obterAnalise(analiseSelecionada)
    : undefined;

  const analiseMotor = analiseMotorRaw && !todasCategoriasSelecionadas
    ? filtrarAnalisePorCategoria(analiseMotorRaw, categoriasFiltro)
    : analiseMotorRaw;

  // ✅ Estado async para relatório (buildRelatorioData é async)
  const [relatorioDataHistorico, setRelatorioDataHistorico] = useState<RelatorioData | null>(null);

  useEffect(() => {
    let cancelado = false;

    async function gerar() {
      if (!analiseSelecionada || !analiseSelecionadaData) {
        setRelatorioDataHistorico(null);
        return;
      }

      try {
        const resultado = await buildRelatorioData(
          analiseSelecionada,
          pacienteSelecionado || clientName.trim() || "Cliente",
          analiseSelecionadaData,
          comparativoExamesData,
          analiseMotor,
          categoriasFiltro,
          examesPaciente.filter(e => e.id !== analiseSelecionada?.id),
          generoSelecionado
        );
        if (!cancelado) setRelatorioDataHistorico(resultado);
      } catch (e) {
        console.error('Erro ao gerar relatório:', e);
        if (!cancelado) setRelatorioDataHistorico(null);
      }
    }

    gerar();
    return () => { cancelado = true; };
  }, [
    analiseSelecionada,
    analiseSelecionadaData,
    pacienteSelecionado,
    clientName,
    comparativoExamesData,
    analiseMotor,
    categoriasFiltro,
    examesPaciente,
    generoSelecionado
  ]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setModalOpen(false);
    }
    if (modalOpen) {
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }
  }, [modalOpen]);

  async function recarregarTodosExames() {
    const list = await listarExames();
    setTodosExames(list);
  }

  async function buscarUltimaAnalise() {
    setError(null);
    const nome = clientName.trim();
    if (!nome) {
      setError("Informe o nome do paciente.");
      return;
    }
    setLoading(true);
    try {
      const list = await listarExamesPorPaciente(nome);
      if (list.length === 0) {
        setError("Nenhuma análise encontrada para este paciente.");
        return;
      }
      const ultimo = list[0];
      setPacienteSelecionado(nome);
      setAnaliseSelecionada(ultimo);
      setExamesPaciente(list);
      setTerapiasEditavel("");
      setCategoriasFiltro([]);
      const todasOcultas = new Set<string>();
      list.forEach((_, i) => todasOcultas.add(String(i)));
      setTerapiasOcultas(todasOcultas);
      setModalOpen(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao buscar última análise.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      setHistoryError(null);
      try {
        const [examesData, baseData, terapiasData] = await Promise.all([
          listarExames(),
          listarBaseAnaliseSaude(),
          listarTerapias(),
        ]);
        setTodosExames(examesData);
        setBaseAnalise(baseData);
        setTerapias(terapiasData);
        const todasOcultas = new Set<string>();
        terapiasData.forEach((_, i) => todasOcultas.add(String(i)));
        setTerapiasOcultas(todasOcultas);
      } catch (e: unknown) {
        setHistoryError(e instanceof Error ? e.message : "Erro ao carregar dados.");
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [totalExames, examesMesAtual] = await Promise.all([
          contarExames(),
          contarExamesMesAtual(),
        ]);
        setDashboard({ totalExames, examesMesAtual });
      } catch { }
    })();
  }, [todosExames.length, loading]);

  useEffect(() => {
    (async () => {
      const q = buscaPacientes.trim();
      if (!q) {
        try { await recarregarTodosExames(); } catch { }
        return;
      }
      try {
        const list = await buscarExamesPorNome(q);
        setTodosExames(list);
      } catch { }
    })();
  }, [buscaPacientes]);

  useEffect(() => {
    if (!existingAnalysisId) return;
    const node = analysisRefs.current[existingAnalysisId];
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
    const timeout = window.setTimeout(() => setExistingAnalysisId(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [existingAnalysisId, examesPaciente]);

  async function onSelecionarPaciente(nome: string) {
    setPacienteSelecionado(nome);
    setClientName(nome);
    setAnaliseSelecionada(null);
    setExamesPaciente([]);
    setHistoryError(null);
    setHistoryLoading(true);
    setTerapiasEditavel("");
    setCategoriasFiltro([]);
    try {
      const list = await listarExamesPorPaciente(nome);
      const listOrdenada = [...list].sort(
        (a, b) =>
          new Date(b.data_exame || b.created_at).getTime() -
          new Date(a.data_exame || a.created_at).getTime()
      );
      setExamesPaciente(listOrdenada);
      const todasOcultas = new Set<string>();
      listOrdenada.forEach((_, i) => todasOcultas.add(String(i)));
      setTerapiasOcultas(todasOcultas);
    } catch (e: unknown) {
      setHistoryError(e instanceof Error ? e.message : "Erro ao carregar exames.");
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
        <aside style={{ width: 300, borderRight: "1px solid var(--border)", padding: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Clientes</div>
          <input
            value={buscaPacientes}
            onChange={(e) => setBuscaPacientes(e.target.value)}
            placeholder="Buscar por nome..."
            style={{
              width: "100%", padding: 10, borderRadius: 8,
              border: "1px solid var(--border)", background: "transparent",
              color: "inherit", marginBottom: 10, boxSizing: "border-box",
            }}
          />
          {historyError ? (
            <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 10 }}>{historyError}</div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {nomesPacientes.map((nome) => (
              <button
                key={nome}
                onClick={() => onSelecionarPaciente(nome)}
                style={{
                  textAlign: "left", padding: "10px 12px", borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: pacienteSelecionado === nome ? "var(--accent-bg)" : "transparent",
                  color: "inherit", cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700 }}>{nome}</div>
              </button>
            ))}
          </div>
        </aside>

        <main style={{ flex: 1, padding: 18 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            {([
              ["Total de exames", dashboard.totalExames],
              ["Exames no mês", dashboard.examesMesAtual],
              ["Pacientes", nomesPacientes.length],
            ] as const).map(([label, value]) => (
              <div key={label} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.1 }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 12 }}>Histórico de análises</div>

          {!pacienteSelecionado ? (
            <div style={{ opacity: 0.8 }}>Selecione um cliente à esquerda para ver os exames.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ minHeight: 340 }}>
                <ComparativoExamesView data={comparativoExamesData ?? COMPARATIVO_VAZIO} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16 }}>
                <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontWeight: 800, marginBottom: 10 }}>Exames — {pacienteSelecionado}</div>
                  {historyLoading ? (
                    <div style={{ opacity: 0.8 }}>Carregando...</div>
                  ) : examesPaciente.length === 0 ? (
                    <div style={{ opacity: 0.8 }}>Nenhum exame encontrado.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {examesPaciente.map((a) => {
                        const dataRaw = a.data_exame || a.created_at;
                        let label = dataRaw;
                        try {
                          const partes = String(dataRaw).split('T')[0].split('-');
                          if (partes.length === 3 && partes[0].length === 4) {
                            const d = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
                            if (!Number.isNaN(d.getTime())) {
                              label = d.toLocaleDateString("pt-BR");
                            }
                          } else {
                            const d = new Date(dataRaw);
                            if (!Number.isNaN(d.getTime())) {
                              label = d.toLocaleString("pt-BR");
                            }
                          }
                        } catch { /* mantém dataRaw */ }
                        const scoreMotor = obterAnalise(a);
                        const corScore =
                          scoreMotor.scoreGeral >= 85 ? "#22c55e"
                            : scoreMotor.scoreGeral >= 70 ? "#84cc16"
                              : scoreMotor.scoreGeral >= 50 ? "#facc15"
                                : scoreMotor.scoreGeral >= 30 ? "#f97316"
                                  : "#ef4444";

                        return (
                          <div
                            key={a.id}
                            ref={(el) => { analysisRefs.current[a.id] = el; }}
                            className={existingAnalysisId === a.id ? "analysis-pulse" : undefined}
                            style={{
                              border: existingAnalysisId === a.id ? "2px solid #f59e0b" : "1px solid var(--border)",
                              borderRadius: 10, padding: 10,
                              background: existingAnalysisId === a.id ? "rgba(245, 158, 11, 0.08)" : "transparent",
                            }}
                          >
                            <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
                            <div style={{ fontSize: 12, color: corScore, fontWeight: 600, marginBottom: 8 }}>
                              {scoreMotor.statusScore} — {scoreMotor.scoreGeral}/100 ({scoreMotor.itensAlterados.length} alterados)
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button className="counter" onClick={() => {
                                setAnaliseSelecionada(a);
                                setTerapiasEditavel("");
                                const todasOcultas = new Set<string>();
                                examesPaciente.forEach((_, i) => todasOcultas.add(String(i)));
                                setTerapiasOcultas(todasOcultas);
                                setCategoriasFiltro([]);
                                setModalOpen(true);
                              }} style={{ marginBottom: 0 }}>
                                Ver
                              </button>
                              <button
                                className="counter"
                                onClick={async () => {
                                  setGerandoPdf(true);
                                  try {
                                    const analiseResult = exameRowToAiData(a, baseAnalise, terapias, terapiasEditavel, categoriasFiltro);
                                    const dados = await buildRelatorioData(
                                      a,
                                      pacienteSelecionado || "Cliente",
                                      analiseResult.data,
                                      comparativoExamesData,
                                      obterAnalise(a),
                                      categoriasFiltro,
                                      examesPaciente.filter(e => e.id !== a.id),
                                      analiseResult.pacienteGenero
                                    );
                                    await gerarRelatorioPDF(dados);
                                  } catch (e) {
                                    console.error('Erro ao gerar PDF:', e);
                                  } finally {
                                    setGerandoPdf(false);
                                  }
                                }}
                                disabled={gerandoPdf}
                              >
                                {gerandoPdf ? <><span className="mystic-loader"></span> Canalizando...</> : "Baixar PDF"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, minHeight: 220 }}>
                  <div style={{ fontWeight: 800, marginBottom: 10 }}>Detalhes da análise</div>
                  {!analiseSelecionada ? (
                    <div style={{ opacity: 0.8 }}>Selecione um exame e clique em "Ver".</div>
                  ) : !analiseSelecionadaData ? (
                    <div style={{ opacity: 0.8 }}>Não foi possível interpretar este exame.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <div>
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>INTERPRETAÇÃO</div>
                        <div style={{ whiteSpace: "pre-wrap", lineHeight: "20px" }}>
                          {analiseSelecionadaData.interpretacao || "—"}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>PONTOS CRÍTICOS</div>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {(analiseSelecionadaData.pontos_criticos ?? []).length
                            ? analiseSelecionadaData.pontos_criticos.map((p: string, i: number) => <li key={i}>{p}</li>)
                            : <li>—</li>}
                        </ul>
                      </div>

                      {analiseMotor && analiseMotor.matches.some((m: any) => m.impacto_fitness) && (
                        <div>
                          <div style={{ fontWeight: 900, marginBottom: 8 }}>MAPA TÉCNICO E IMPACTO FITNESS</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {analiseMotor.matches
                              .filter((m: any) => m.impacto_fitness)
                              .slice(0, 10)
                              .map((m: any, i: number) => (
                                <div key={i} style={{ background: "rgba(2, 132, 199, 0.1)", padding: "10px", borderRadius: 6, borderLeft: "3px solid #0284c7" }}>
                                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: "#fff" }}>
                                    {m.categoria} — {m.itemBase}
                                    <span style={{ marginLeft: 8, color: "#f87171", fontWeight: 600 }}>({m.gravidade})</span>
                                  </div>
                                  {m.impacto && (
                                    <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 6 }}>{m.impacto}</div>
                                  )}
                                  <div style={{ fontSize: 11, color: "#38bdf8" }}>
                                    {Object.entries(m.impacto_fitness).map(([key, val]) => (
                                      <div key={key}>• <b>{key.charAt(0).toUpperCase() + key.slice(1)}:</b> {String(val)}</div>
                                    ))}
                                  </div>
                                </div>
                              ))
                            }
                          </div>
                        </div>
                      )}

                      <SecaoPlanoTerapeutico
                        data={analiseSelecionadaData}
                        editavel={terapiasEditavel}
                        onChangeEditavel={setTerapiasEditavel}
                        ocultas={terapiasOcultas}
                        onToggleOculta={(idx) => setTerapiasOcultas(prev => {
                          const novo = new Set(prev);
                          if (novo.has(idx)) novo.delete(idx); else novo.add(idx);
                          return novo;
                        })}
                      />

                      {analiseMotor && analiseMotor.setoresAfetados.length > 0 && (
                        <div>
                          <div style={{ fontWeight: 900, marginBottom: 6 }}>SETORES AFETADOS</div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {analiseMotor.setoresAfetados.map((s: string) => (
                              <span key={s} style={{ background: "rgba(56, 189, 248, 0.15)", border: "1px solid rgba(56, 189, 248, 0.3)", padding: "3px 10px", borderRadius: 6, fontSize: 13, color: "#38bdf8" }}>
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <ComparativoExamesView data={comparativoExamesData ?? COMPARATIVO_VAZIO} />

                      <div className="lunara">
                        <div className="sectionTitle" style={{ marginBottom: 8 }}>Frequência Solfeggio para Sessão</div>
                        <div style={{ whiteSpace: "pre-wrap", color: "var(--text-h)" }}>
                          🎵 {analiseSelecionadaData.frequencia_lunara || "—"}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>JUSTIFICATIVA TERAPÊUTICA</div>
                        <div style={{ whiteSpace: "pre-wrap" }}>{analiseSelecionadaData.justificativa || "—"}</div>
                      </div>

                      {relatorioDataHistorico ? (
                        <button
                          id="btn-pdf-lateral"
                          className="counter"
                          onClick={() => {
                            setGerandoPdf(true);
                            if (relatorioDataHistorico) gerarRelatorioPDF(getDataParaPdf(relatorioDataHistorico, terapiasOcultas));
                            setGerandoPdf(false);
                          }}
                          disabled={!relatorioDataHistorico || gerandoPdf}
                          style={{ marginBottom: 0 }}
                        >
                          Gerar PDF
                        </button>
                      ) : null}
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}

          <div style={{ height: 20 }} />

          <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, maxWidth: 760 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Nova análise (PDF)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Nome do paciente"
                style={{ padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "inherit" }}
              />
              <button className="counter" onClick={buscarUltimaAnalise} disabled={loading}>
                {loading ? "Carregando..." : "Gerar Última Análise"}
              </button>
              {error ? <div style={{ color: "#ef4444", fontSize: 14 }}>{error}</div> : null}
            </div>
          </section>
        </main>
      </div>

      {modalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setModalOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", padding: 16, zIndex: 50 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(920px, 96vw)", maxHeight: "92vh", overflow: "auto",
              background: "rgba(17, 24, 39, 0.98)", border: "1px solid var(--border)",
              borderRadius: 14, padding: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  {(pacienteSelecionado ?? clientName.trim()) || "Paciente"} —{" "}
                  {analiseSelecionada?.data_exame ?? analiseSelecionada?.created_at ?? ""}
                </div>
                {analiseMotor && (
                  <div style={{ fontSize: 13, color: "#38bdf8", marginTop: 4, display: "flex", gap: 15, flexWrap: "wrap", alignItems: "center" }}>
                    <span>Score {analiseMotor.scoreGeral}/100 — {analiseMotor.statusScore}</span>
                    <span>{analiseMotor.itensAlterados.length} alterados | {analiseMotor.terapias.length} terapias</span>

                    {analiseMotor.paciente.imc && (
                      <span style={{
                        background: analiseMotor.paciente.imc >= 25 ? "rgba(239, 68, 68, 0.2)" : "rgba(34, 197, 94, 0.2)",
                        padding: "2px 8px", borderRadius: 4, fontWeight: 700,
                        color: analiseMotor.paciente.imc >= 25 ? "#f87171" : "#4ade80"
                      }}>
                        IMC: {analiseMotor.paciente.imc.toFixed(1)} ({analiseMotor.paciente.classificacaoImc})
                        {analiseMotor.paciente.peso && ` • ${analiseMotor.paciente.peso}`}
                        {analiseMotor.paciente.altura && ` • ${analiseMotor.paciente.altura}`}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  id="btn-pdf-modal"
                  className="counter"
                  onClick={() => {
                    setGerandoPdf(true);
                    setTimeout(async () => {
                      try {
                        if (relatorioDataHistorico) {
                          await gerarRelatorioPDF(getDataParaPdf(relatorioDataHistorico, terapiasOcultas));
                        }
                      } catch (e) {
                        console.error(e);
                      } finally {
                        setGerandoPdf(false);
                      }
                    }, 50);
                  }}
                  disabled={!relatorioDataHistorico || gerandoPdf}
                  style={{ marginBottom: 0 }}
                >
                  {gerandoPdf ? <><span className="mystic-loader"></span> Gerando Relatório...</> : "Gerar PDF"}
                </button>
                <button className="counter" onClick={() => setModalOpen(false)} style={{ marginBottom: 0 }}>
                  Fechar
                </button>
              </div>
            </div>

            {/* 🔥 FILTROS POR CATEGORIA */}
            <div style={{ marginBottom: 16, padding: 12, background: '#1e293b', borderRadius: 8 }}>
              <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.8, fontWeight: 600 }}>📊 Filtrar por categoria:</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {CATEGORIAS_DISPONIVEIS.map(cat => (
                  <label key={cat} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', cursor: 'pointer',
                    borderRadius: 6, fontSize: 12, background: estaSelecionado(cat) ? '#0ea5e9' : '#334155',
                    border: estaSelecionado(cat) ? '1px solid #38bdf8' : '1px solid transparent', transition: 'all 0.2s'
                  }}>
                    <input type="checkbox" checked={categoriasFiltro.includes(cat)} onChange={() => toggleCategoria(cat)}
                      style={{ accentColor: '#0ea5e9', width: 14, height: 14, margin: 0 }} />
                    <span>{cat === 'emotional' ? 'Emocional' : cat}</span>
                  </label>
                ))}
                {categoriasFiltro.length > 0 && (
                  <button onClick={() => setCategoriasFiltro([])}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 12, textDecoration: 'underline', marginLeft: 'auto' }}>
                    Limpar
                  </button>
                )}
              </div>
            </div>

            {!analiseSelecionada ? (
              <div style={{ opacity: 0.85 }}>Nenhum exame selecionado.</div>
            ) : !analiseSelecionadaData ? (
              <div style={{ opacity: 0.85 }}>Não foi possível interpretar este exame.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>INTERPRETAÇÃO</div>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: "20px" }}>
                    {analiseSelecionadaData.interpretacao || "—"}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>PONTOS CRÍTICOS</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {(analiseSelecionadaData.pontos_criticos ?? []).length
                      ? analiseSelecionadaData.pontos_criticos.map((p: string, i: number) => <li key={i}>{p}</li>)
                      : <li>—</li>}
                  </ul>
                </div>

                {analiseMotor && analiseMotor.matches.some((m: any) => m.impacto_fitness) && (
                  <div>
                    <div style={{ fontWeight: 900, marginBottom: 8 }}>MAPA TÉCNICO E IMPACTO FITNESS</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {analiseMotor.matches
                        .filter((m: any) => m.impacto_fitness)
                        .slice(0, 10)
                        .map((m: any, i: number) => (
                          <div key={i} style={{ background: "rgba(2, 132, 199, 0.1)", padding: "10px", borderRadius: 6, borderLeft: "3px solid #0284c7" }}>
                            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: "#fff" }}>
                              {m.categoria} — {m.itemBase}
                              <span style={{ marginLeft: 8, color: "#f87171", fontWeight: 600 }}>({m.gravidade})</span>
                            </div>
                            {m.impacto && (
                              <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 6 }}>{m.impacto}</div>
                            )}
                            <div style={{ fontSize: 11, color: "#38bdf8" }}>
                              {Object.entries(m.impacto_fitness).map(([key, val]) => (
                                <div key={key}>• <b>{key.charAt(0).toUpperCase() + key.slice(1)}:</b> {String(val)}</div>
                              ))}
                            </div>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                )}

                <SecaoPlanoTerapeutico
                  data={analiseSelecionadaData}
                  editavel={terapiasEditavel}
                  onChangeEditavel={setTerapiasEditavel}
                  ocultas={terapiasOcultas}
                  onToggleOculta={(idx) => setTerapiasOcultas(prev => {
                    const novo = new Set(prev);
                    if (novo.has(idx)) novo.delete(idx); else novo.add(idx);
                    return novo;
                  })}
                />

                {analiseMotor && analiseMotor.setoresAfetados.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 900, marginBottom: 6 }}>SETORES AFETADOS</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {analiseMotor.setoresAfetados.map((s: string) => (
                        <span key={s} style={{ background: "rgba(56, 189, 248, 0.15)", border: "1px solid rgba(56, 189, 248, 0.3)", padding: "3px 10px", borderRadius: 6, fontSize: 13, color: "#38bdf8" }}>
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="lunara">
                  <div className="sectionTitle" style={{ marginBottom: 8 }}>Frequência Solfeggio para Sessão</div>
                  <div style={{ whiteSpace: "pre-wrap", color: "var(--text-h)" }}>
                    🎵 {analiseSelecionadaData.frequencia_lunara || "—"}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>JUSTIFICATIVA TERAPÊUTICA</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{analiseSelecionadaData.justificativa || "—"}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

export default App;