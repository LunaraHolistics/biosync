import type { AiStructuredData, MatchWithScore } from "./services/api";
import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
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
  salvarItemScores,
  type ExameRow,
  type TerapiaRow,
  type BaseAnaliseSaudeRow,
} from "./services/db";

import {
  gerarAnaliseCompleta,
  gerarComparativoInteligente,
  type AnaliseCompleta,
} from "./lib/motorSemantico";

// ============================================================================
// 🔥 CONFIGURAÇÕES E CONSTANTES
// ============================================================================

export const CATEGORIAS_DISPONIVEIS = ['fitness', 'emotional', 'sono', 'imunidade', 'mental'] as const;
export type CategoriaFiltro = typeof CATEGORIAS_DISPONIVEIS[number];

export const PALAVRAS_CHAVE_POR_CATEGORIA: Record<CategoriaFiltro, string[]> = {
  fitness: ['fisico', 'fitness', 'performance', 'treino', 'musculo', 'forca', 'energia', 'metabolismo', 'peso', 'gordura', 'colesterol', 'viscosidade', 'circulacao', 'coracao', 'vascular', 'miocardio', 'perfusao', 'oxigenio', 'aerobico', 'fadiga', 'resistencia', 'capacidade', 'exercicio', 'atletico', 'cardio', 'respiratorio', 'pulmao', 'sangue', 'arteria', 'veia'],
  emotional: ['emocional', 'emotional', 'emocao', 'sentimento', 'ansiedade', 'depressao', 'medo', 'culpa', 'vergonha', 'raiva', 'tristeza', 'luto', 'apego', 'magoa', 'estresse', 'humor', 'instabilidade', 'afetivo', 'psicologico', 'trauma', 'frustracao', 'desanimo', 'apatia', 'melancolia', 'saudade', 'solidao', 'rejeicao', 'abandono'],
  sono: ['sono', 'insomnia', 'insonia', 'dormir', 'descanso', 'repouso', 'letargia', 'cansaco', 'exaustao', 'fadiga', 'acordar', 'noite', 'melatonina', 'despertar', 'ciclo', 'ritmo', 'circadiano', 'sonolencia', 'vigilia', 'cochilo'],
  imunidade: ['imunidade', 'imune', 'defesa', 'alergia', 'alergeno', 'inflamacao', 'infeccao', 'virus', 'bacteria', 'fungo', 'parasita', 'linfonodo', 'amigdala', 'bao', 'timo', 'imunoglobulina', 'respiratorio', 'gastrointestinal', 'mucosa', 'anticorpo', 'leucocito', 'linfocito', 'resistencia', 'protecao', 'vacina', 'imunizacao'],
  mental: ['mental', 'cognitivo', 'pensamento', 'memoria', 'concentracao', 'foco', 'razao', 'logica', 'aprendizado', 'nevoa', 'brain fog', 'confusao', 'clareza', 'neurologico', 'cerebro', 'cerebral', 'nervoso', 'sinapse', 'intelecto', 'raciocinio', 'julgamento', 'decisao', 'intuicao', 'percepcao', 'consciencia', 'mente']
};

const COMPARATIVO_VAZIO = {
  melhoraram: [],
  pioraram: [],
  novos_problemas: [],
  normalizados: [],
} as const;

const SCORES_GENERICOS = [0, 50, 100] as const;

// ============================================================================
// 🔷 TIPOS
// ============================================================================

type DiagnosticoPdf = {
  problemas: Array<{
    sistema: string;
    item: string;
    status: string;
    impacto: string;
    score?: number;
  }>;
};

export type ItemScoreEvolucao = {
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

type ItemScoreRaw = {
  item: string;
  score_atual: number;
  score_anterior?: number | null;
  delta?: number;
  trend?: string;
  categoria?: string;
  impacto?: string;
  impacto_fitness?: string;
  [key: string]: unknown;
};

type DashboardStats = {
  totalExames: number;
  examesMesAtual: number;
};

type ModalState = {
  isOpen: boolean;
  selectedExame: ExameRow | null;
};

// ============================================================================
// 🔷 UTILITÁRIOS - HELPERS
// ============================================================================

/**
 * Extrai metadados do resultado JSON do exame
 */
export function resultadoMeta(row: ExameRow): Record<string, unknown> {
  const r = row.resultado_json;
  return r && typeof r === "object" && !Array.isArray(r)
    ? (r as Record<string, unknown>)
    : {};
}

/**
 * Converte valor desconhecido para DiagnosticoPdf válido
 */
export function toDiagnostico(value: unknown): DiagnosticoPdf | undefined {
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

/**
 * Formata o tipo de plano terapêutico para exibição
 */
export function labelPlanoTipo(t: AiStructuredData["plano_terapeutico"]["tipo"]): string {
  const labels: Record<string, string> = {
    semanal: "Semanal",
    quinzenal: "Quinzenal",
    mensal: "Mensal",
  };
  return labels[t ?? "mensal"] ?? "Mensal";
}

/**
 * Extrai gênero do campo nome_paciente
 */
export function extrairGeneroPaciente(nomePaciente: string): 'masculino' | 'feminino' | undefined {
  if (!nomePaciente) return undefined;
  const match = nomePaciente.match(/Sexo:\s*(Masculino|Feminino)/i);
  if (!match) return undefined;
  return match[1].toLowerCase() as 'masculino' | 'feminino';
}

/**
 * Verifica se scores são genéricos (valores placeholder)
 */
export function scoresSaoGenericos(scores: ItemScoreEvolucao[]): boolean {
  if (!scores?.length) return true;
  if (scores.length === 1) return false;

  const valoresUnicos = new Set(scores.map(s => s.score_atual));
  if (valoresUnicos.size === 1) {
    const valor = [...valoresUnicos][0];
    console.warn(`⚠️ [SCORES GENÉRICOS] ${scores.length} itens com score ${valor}`);
    return SCORES_GENERICOS.includes(valor as typeof SCORES_GENERICOS[number]);
  }

  const contagem = new Map<number, number>();
  for (const s of scores) {
    contagem.set(s.score_atual, (contagem.get(s.score_atual) || 0) + 1);
  }
  const maxContagem = Math.max(...contagem.values());
  if (maxContagem / scores.length >= 0.9) {
    const valorDominante = [...contagem.entries()].find(([_, c]) => c === maxContagem)?.[0];
    console.warn(`⚠️ [SCORES SUSPEITOS] ${maxContagem}/${scores.length} itens com score ${valorDominante}`);
    return true;
  }

  return false;
}

/**
 * Calcula tendência baseada na variação de scores
 */
export function calcularTendenciaItem(scoreAtual: number, scoreAnterior: number | null): ItemScoreEvolucao['trend'] {
  if (scoreAnterior === null) return 'novo';
  const delta = scoreAtual - scoreAnterior;
  if (delta >= 10) return 'melhorou';
  if (delta <= -10) return 'piorou';
  return 'estavel';
}

/**
 * Extrai scores dos pontos críticos via regex
 */
export function extrairScoresDosPontosCriticos(pontosCriticos: string[]): Map<string, number> {
  const map = new Map<string, number>();
  const patterns = [
    /^·?\s*(.+?)\s*[:：]\s*(\d{1,3})\s*$/,
    /^·?\s*(.+?)\s*[—\-–]\s*(\d{1,3})\s*$/,
    /^·?\s*(.+?)\s*[(（]\s*(\d{1,3})\s*[)）]\s*$/,
  ];

  for (const p of pontosCriticos) {
    for (const pattern of patterns) {
      const match = p.match(pattern);
      if (match) {
        const item = match[1].trim().replace(/^·\s*/, '').toLowerCase();
        const score = parseInt(match[2], 10);
        if (!Number.isNaN(score) && score >= 0 && score <= 100) {
          map.set(item, score);
          break;
        }
      }
    }
  }
  return map;
}

/**
 * Parse de data local para timestamp
 */
function parseDataLocal(valor: string | Date): number {
  if (valor instanceof Date) return valor.getTime();
  const str = String(valor).split('T')[0];
  const partes = str.split('-');
  if (partes.length === 3 && partes[0].length === 4) {
    return new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2])).getTime();
  }
  return new Date(valor).getTime();
}

/**
 * Extrai scores do exame anterior para comparação
 */
export function extrairScoresExameAnterior(
  examesAnteriores: ExameRow[],
  dataExameAtual?: string | Date,
  idExameAtual?: string,
  base?: BaseAnaliseSaudeRow[],
  terapias?: TerapiaRow[]
): Map<string, ItemScoreEvolucao> {
  const mapa = new Map<string, ItemScoreEvolucao>();
  if (!examesAnteriores?.length) return mapa;

  const dataAtualMs = dataExameAtual ? parseDataLocal(dataExameAtual) : Infinity;

  const anterioresValidos = examesAnteriores
    .filter(e => {
      if (idExameAtual && e.id === idExameAtual) return false;
      const dataExameMs = parseDataLocal(e.data_exame || e.created_at);
      if (dataExameMs === dataAtualMs) {
        return new Date(e.created_at).getTime() < Date.now();
      }
      return dataExameMs < dataAtualMs;
    })
    .sort((a, b) => parseDataLocal(b.data_exame || b.created_at) - parseDataLocal(a.data_exame || a.created_at));

  const anterior = anterioresValidos[0];
  if (!anterior) return mapa;

  console.log(`🔍 [EVOLUÇÃO] Exame anterior: ${anterior.id.substring(0, 6)} | ${anterior.data_exame}`);

  // Tentativa 1: indice_biosync.item_scores
  const ib = anterior.indice_biosync;
  if (ib && typeof ib === 'object' && 'item_scores' in ib && Array.isArray((ib as any).item_scores)) {
    const items = (ib as any).item_scores as ItemScoreEvolucao[];
    for (const item of items) {
      const chave = (item.item || '').trim().replace(/[:：]$/, '').toLowerCase();
      if (chave && typeof item.score_atual === 'number') {
        mapa.set(chave, item);
      }
    }
    if (mapa.size > 0 && !scoresSaoGenericos(Array.from(mapa.values()))) {
      console.log(`✅ [EVOLUÇÃO] ${mapa.size} scores do banco`);
      return mapa;
    }
  }

  // Tentativa 2: Motor semântico no exame anterior
  if (base?.length && terapias?.length) {
    try {
      const analiseAnterior = gerarAnaliseCompleta(anterior, base, terapias);
      if (analiseAnterior.matches?.length) {
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
      console.warn('⚠️ [EVOLUÇÃO] Falha no motor semântico:', e);
    }
  }

  return mapa;
}

/**
 * Filtra análise por categorias selecionadas
 */
export function filtrarAnalisePorCategoria(analise: AnaliseCompleta, categoriasFiltro: CategoriaFiltro[]): AnaliseCompleta {
  if (!categoriasFiltro?.length) return analise;

  const filtroNorm = categoriasFiltro.map(c => c.toLowerCase());
  const palavrasChaveAtivas = new Set<string>();
  
  for (const cat of categoriasFiltro) {
    palavrasChaveAtivas.add(cat.toLowerCase());
    PALAVRAS_CHAVE_POR_CATEGORIA[cat]?.forEach(p => palavrasChaveAtivas.add(p.toLowerCase()));
  }

  const temKeyword = (texto: string) => 
    [...palavrasChaveAtivas].some(kw => kw.length > 2 && texto.toLowerCase().includes(kw));

  // Filtrar interpretação
  let interpretacaoFiltrada = analise.interpretacao;
  if (analise.interpretacao && categoriasFiltro.length > 0) {
    const introMatch = analise.interpretacao.match(/^([\s\S]*?)(?=\b(?:[A-ZÀ-Ú]{4,}(?:\s+[A-ZÀ-Ú]+)*)\b)/);
    const intro = introMatch?.[1]?.trim() || '';
    const secoesRaw = analise.interpretacao.split(/(?=\b(?:[A-ZÀ-Ú]{4,}(?:\s+[A-ZÀ-Ú]+)*)\b)/);
    
    const secoesFiltradas = secoesRaw.filter(secao => {
      if (!secao?.trim()) return false;
      if (temKeyword(secao)) return true;
      const titulo = secao.match(/^\b([A-ZÀ-Ú][A-ZÀ-Ú\s]+)\b/)?.[1]?.trim();
      return titulo && filtroNorm.some(cat => titulo.toLowerCase().includes(cat));
    });

    const conclusao = analise.interpretacao.match(/(Conclus[aã]o[\s\S]*$)/i)?.[1]?.trim() || '';
    const partes = [intro, ...secoesFiltradas, conclusao].filter(Boolean);
    interpretacaoFiltrada = partes.join('\n\n').trim() || analise.interpretacao;
  }

  // Filtrar pontos críticos
  const pontosCriticosFiltrados = analise.pontosCriticos.filter((p: string) => {
    const item = p.match(/^·?\s*([^:：]+):/)?.[1]?.trim() || p;
    return filtroNorm.some(cat => {
      const palavras = PALAVRAS_CHAVE_POR_CATEGORIA[cat] || [];
      return item.toLowerCase().includes(cat) || 
        palavras.some(palavra => p.toLowerCase().includes(palavra) || item.toLowerCase().includes(palavra));
    });
  });

  // Filtrar matches, terapias e setores
  const matchesFiltrados = analise.matches.filter((m: any) => {
    const cat = (m.categoria || '').toLowerCase();
    return filtroNorm.some(f => cat.includes(f) || f.includes(cat));
  });

  const terapiasFiltradas = analise.terapias.filter((t: any) => {
    const tags = [t.categoria, ...(t.tags || [])].filter(Boolean).map((tag: string) => tag.toLowerCase());
    return tags.some((tag: string) => filtroNorm.some(f => tag.includes(f) || f.includes(tag)));
  });

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
    setoresAfetados: setoresFiltrados,
  };
}

/**
 * Remove terapias ocultas dos dados do PDF
 */
export function getDataParaPdf(data: RelatorioData, ocultas: Set<string>): RelatorioData {
  if (!ocultas?.size) return data;
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

// ============================================================================
// 🔷 COMPONENTES AUXILIARES
// ============================================================================

interface SecaoPlanoTerapeuticoProps {
  data: AiStructuredData;
  editavel?: string;
  onChangeEditavel?: (v: string) => void;
  ocultas?: Set<string>;
  onToggleOculta?: (idx: string) => void;
}

const SecaoPlanoTerapeutico = memo(function SecaoPlanoTerapeutico({
  data,
  editavel,
  onChangeEditavel,
  ocultas,
  onToggleOculta,
}: SecaoPlanoTerapeuticoProps) {
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
        {ocultas?.size ? (
          <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 400, background: "rgba(245, 158, 11, 0.1)", padding: "2px 8px", borderRadius: 4 }}>
            {ocultas.size} ocultada(s)
          </span>
        ) : null}
      </div>

      {p.terapias.length > 0 && (
        <>
          <div style={{ marginBottom: 10, fontSize: 13, color: "#64748b" }}>
            <b>Periodicidade:</b> {labelPlanoTipo(p.tipo)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {p.terapias.map((item: any, i: number) => {
              const idx = String(i);
              const isOculta = ocultas?.has(idx);

              if (isOculta) {
                return (
                  <div
                    key={i}
                    onClick={() => onToggleOculta?.(idx)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && onToggleOculta?.(idx)}
                    style={{
                      display: "flex", gap: 10,
                      border: "1px dashed #475569", borderRadius: 10, padding: 10,
                      opacity: 0.6, cursor: "pointer", transition: "all 0.2s",
                      background: "rgba(71, 85, 105, 0.05)"
                    }}
                    title="Clique para restaurar esta terapia ao PDF"
                  >
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", paddingTop: 2 }}>
                      <input type="checkbox" checked readOnly aria-label="Terapia restaurada"
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
                    <input 
                      type="checkbox" 
                      checked={false} 
                      onChange={() => onToggleOculta?.(idx)}
                      aria-label={`Ocultar terapia ${item.nome}`}
                      style={{ cursor: "pointer", accentColor: "#ef4444", width: 16, height: 16 }}
                      title="Clique para ocultar esta terapia do PDF" 
                    />
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
            aria-label="Adicionar terapias manualmente"
          />
        </div>
      )}
    </div>
  );
});

// ============================================================================
// 🔷 CONVERSÃO E FORMATAÇÃO
// ============================================================================

interface TerapiaFormatada {
  nome: string;
  frequencia: string;
  descricao: string;
  justificativa: string;
}

function formatarTerapias(
  terapias: any[],
  terapiasManuais?: string
): TerapiaFormatada[] {
  const terapiasFormatadas: TerapiaFormatada[] = terapias.map((t) => ({
    nome: t.nome,
    frequencia: t.frequencia ?? t.frequencia_recomendada ?? "Conforme necessidade",
    descricao: t.descricao ?? t.indicacoes ?? "",
    justificativa: t.motivos?.length
      ? `Setores: ${t.motivos.join(", ")}. ${t.indicacoes ?? ""}`
      : t.indicacoes ?? "",
  }));

  if (terapiasManuais?.trim()) {
    const linhas = terapiasManuais.split("\n").filter((l) => l.trim().length > 0);
    for (const linha of linhas) {
      const partes = linha.split("—").map((s) => s.trim());
      terapiasFormatadas.push({
        nome: partes[0] ?? "Terapia",
        frequencia: partes[1] ?? "",
        descricao: partes.slice(2).join(" — ") ?? "",
        justificativa: "Adicionada manualmente pelo profissional.",
      });
    }
  }

  return terapiasFormatadas;
}

export function exameRowToAiData(
  row: ExameRow,
  base: BaseAnaliseSaudeRow[],
  terapias: TerapiaRow[],
  terapiasManuais?: string,
  filtrosAtivos?: CategoriaFiltro[]
): { data: AiStructuredData; pacienteGenero?: 'masculino' | 'feminino' } {
  const analiseRaw = gerarAnaliseCompleta(row, base, terapias);
  const analise = filtrosAtivos?.length 
    ? filtrarAnalisePorCategoria(analiseRaw, filtrosAtivos) 
    : analiseRaw;

  const terapiasFormatadas = formatarTerapias(analise.terapias, terapiasManuais);
  const setoresParaJustificativa = filtrosAtivos?.length 
    ? analise.setoresAfetados.filter(s => filtrosAtivos.includes(s as CategoriaFiltro))
    : analise.setoresAfetados;

  const pacienteGenero = extrairGeneroPaciente(row.nome_paciente);

  return {
    data: {
      interpretacao: analise.interpretacao,
      pontos_criticos: analise.pontosCriticos,
      plano_terapeutico: {
        tipo: "mensal" as const,
        terapias: terapiasFormatadas,
      },
      frequencia_lunara: analise.frequencia_lunara ?? "",
      justificativa: `Score: ${analise.scoreGeral}/100 — ${analise.statusScore}. Setores: ${setoresParaJustificativa.join(", ") || "nenhum"}.`,
    },
    pacienteGenero,
  };
}

// ============================================================================
// 🔷 BUILD RELATÓRIO - FUNÇÃO PRINCIPAL
// ============================================================================

export async function buildRelatorioData(
  row: ExameRow,
  paciente: string,
  data: AiStructuredData,
  comparacao?: any,
  motor?: AnaliseCompleta,
  filtrosAtivos?: CategoriaFiltro[],
  examesAnteriores?: ExameRow[],
  pacienteGenero?: 'masculino' | 'feminino',
  baseAnaliseIn?: BaseAnaliseSaudeRow[],
  terapiasIn?: TerapiaRow[]
): Promise<RelatorioData> {
  const meta = resultadoMeta(row);
  let baseAnalise = baseAnaliseIn;
  let terapias = terapiasIn;

  // Auto-fetch se necessário
  if (!baseAnalise?.length || !terapias?.length) {
    try {
      const [baseData, terapiasData] = await Promise.all([
        baseAnalise?.length ? Promise.resolve(baseAnalise) : listarBaseAnaliseSaude(),
        terapias?.length ? Promise.resolve(terapias) : listarTerapias()
      ]);
      baseAnalise = baseData;
      terapias = terapiasData;
    } catch (e) {
      console.warn('⚠️ [AUTO] Falha ao buscar base/terapias:', e);
    }
  }

  let itemScoresEvolucao: ItemScoreEvolucao[] = [];
  let fonteUsada = 'nenhuma';

  // Fonte 1: motor.matches
  if (motor?.matches?.length) {
    const scoresDoMotor = motor.matches
      .filter((m): m is MatchWithScore => !!m.itemBase && typeof m.score === 'number')
      .map((m) => ({
        item: m.itemBase,
        categoria: m.categoria ?? 'geral',
        score_atual: m.score,
        score_anterior: null,
        delta: 0,
        trend: 'novo' as const,
        impacto: m.impacto ?? 'Desequilíbrio bioenergético identificado',
        impacto_fitness: (m as any).impacto_fitness,
      }));

    if (!scoresSaoGenericos(scoresDoMotor) && scoresDoMotor.length > 0) {
      itemScoresEvolucao = scoresDoMotor;
      fonteUsada = 'motor.matches';
    }
  }

  // Fonte 2: pontos_criticos
  if (!itemScoresEvolucao.length && data.pontos_criticos?.length) {
    const scoresDoTexto = extrairScoresDosPontosCriticos(data.pontos_criticos);
    if (scoresDoTexto.size > 0 && new Set(scoresDoTexto.values()).size > 1) {
      itemScoresEvolucao = Array.from(scoresDoTexto.entries()).map(([item, score]) => ({
        item: item.replace(/^./, c => c.toUpperCase()),
        categoria: 'geral',
        score_atual: score,
        score_anterior: null,
        delta: 0,
        trend: 'novo' as const,
        impacto: 'Desequilíbrio identificado nos pontos críticos',
      }));
      fonteUsada = 'pontos_criticos';
    }
  }

  // Fonte 3: indice_biosync
  if (!itemScoresEvolucao.length && row.indice_biosync && typeof row.indice_biosync === 'object') {
    const biosync = row.indice_biosync as { item_scores?: ItemScoreRaw[] };
    if (Array.isArray(biosync.item_scores) && biosync.item_scores.length > 0) {
      const scoresDoBanco = biosync.item_scores
        .filter((is): is is ItemScoreRaw => !!is.item && typeof is.score_atual === 'number')
        .map((is) => ({
          item: is.item,
          categoria: is.categoria ?? 'geral',
          score_atual: is.score_atual,
          score_anterior: typeof is.score_anterior === 'number' ? is.score_anterior : null,
          delta: is.delta ?? 0,
          trend: (is.trend ?? 'novo') as ItemScoreEvolucao['trend'],
          impacto: is.impacto ?? 'Desequilíbrio bioenergético identificado',
          impacto_fitness: is.impacto_fitness,
        }));

      if (!scoresSaoGenericos(scoresDoBanco) && scoresDoBanco.length > 0) {
        itemScoresEvolucao = scoresDoBanco;
        fonteUsada = 'indice_biosync';
      }
    }
  }

  // Evolução: preencher score_anterior
  let avisoComparacao: string | undefined;
  if (itemScoresEvolucao.length && examesAnteriores?.length) {
    const mapaAnterior = extrairScoresExameAnterior(
      examesAnteriores,
      row.data_exame ?? row.created_at,
      row.id,
      baseAnalise,
      terapias
    );

    if (mapaAnterior.size > 0) {
      itemScoresEvolucao = itemScoresEvolucao.map(item => {
        const chave = item.item.trim().replace(/[:：]$/, '').toLowerCase();
        const anterior = mapaAnterior.get(chave);
        if (anterior) {
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
    } else {
      avisoComparacao = "Primeiro exame disponível para comparação. Scores salvos — evolução aparecerá no próximo exame.";
    }
  } else if (itemScoresEvolucao.length) {
    avisoComparacao = "Primeiro exame disponível para comparação. Scores salvos — evolução aparecerá no próximo exame.";
  }

  // Persistir scores (fire-and-forget)
  if (itemScoresEvolucao.length && fonteUsada === 'motor.matches') {
    salvarItemScores(row.id, itemScoresEvolucao).catch((err) => {
      console.warn('⚠️ Falha ao persistir scores:', err);
    });
  }

  return {
    clientName: paciente ?? "Cliente",
    createdAt: new Date(row.data_exame ?? row.created_at),
    interpretacao: data.interpretacao ?? "",
    pontos_criticos: data.pontos_criticos ?? [],
    plano_terapeutico: data.plano_terapeutico,
    frequencia_lunara: data.frequencia_lunara ?? "",
    justificativa: avisoComparacao
      ? `${data.justificativa ?? ""}\n\n⚠️ ${avisoComparacao}`
      : (data.justificativa ?? ""),
    diagnostico: motor 
      ? {
          problemas: motor.matches.map((m: any) => ({
            sistema: m.categoria,
            item: m.itemBase,
            status: m.gravidade,
            impacto: m.impacto,
            impacto_fitness: (m as any).impacto_fitness,
          }))
        } 
      : toDiagnostico(meta.diagnostico),
    comparacao,
    relatorio_original_html: getRelatorioOriginal(meta, row),
    filtros_aplicados: filtrosAtivos?.length ? filtrosAtivos : undefined,
    item_scores: itemScoresEvolucao.length ? itemScoresEvolucao : undefined,
    pacienteGenero,
  };
}

function getRelatorioOriginal(meta: Record<string, unknown>, _row: ExameRow): string | undefined {
  if (meta && typeof meta === "object" && "relatorio_original_html" in meta) {
    const val = (meta as any).relatorio_original_html;
    if (typeof val === "string" && val.length > 0) return val;
  }
  return undefined;
}

// ============================================================================
// 🔷 COMPONENTE PRINCIPAL - APP
// ============================================================================

function App() {
  // Estados principais
  const [clientName, setClientName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingAnalysisId, setExistingAnalysisId] = useState<string | null>(null);
  
  // Dados
  const [todosExames, setTodosExames] = useState<ExameRow[]>([]);
  const [buscaPacientes, setBuscaPacientes] = useState("");
  const [pacienteSelecionado, setPacienteSelecionado] = useState<string | null>(null);
  const [analiseSelecionada, setAnaliseSelecionada] = useState<ExameRow | null>(null);
  const [examesPaciente, setExamesPaciente] = useState<ExameRow[]>([]);
  
  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  
  // Configurações
  const [baseAnalise, setBaseAnalise] = useState<BaseAnaliseSaudeRow[]>([]);
  const [terapias, setTerapias] = useState<TerapiaRow[]>([]);
  const [categoriasFiltro, setCategoriasFiltro] = useState<CategoriaFiltro[]>([]);
  const [cacheAnalise, setCacheAnalise] = useState<Record<string, AnaliseCompleta>>({});
  const [terapiasEditavel, setTerapiasEditavel] = useState("");
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [terapiasOcultas, setTerapiasOcultas] = useState<Set<string>>(new Set());
  
  // Dashboard
  const [dashboard, setDashboard] = useState<DashboardStats>({ totalExames: 0, examesMesAtual: 0 });
  
  // Refs
  const analysisRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [relatorioDataHistorico, setRelatorioDataHistorico] = useState<RelatorioData | null>(null);

  // Memoized values
  const todasCategoriasSelecionadas = useMemo(() => categoriasFiltro.length === 0, [categoriasFiltro]);
  
  const nomesPacientes = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of todosExames) {
      const n = e.nome_paciente?.trim();
      if (n) map.set(n, n);
    }
    return Array.from(map.keys()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [todosExames]);

  const comparativoExamesData = useMemo(() => {
    if (examesPaciente.length < 2) return null;
    const ordenados = [...examesPaciente].sort(
      (a, b) => new Date(b.data_exame || b.created_at).getTime() - new Date(a.data_exame || a.created_at).getTime()
    );
    return gerarComparativoInteligente(ordenados);
  }, [examesPaciente]);

  const analiseResult = useMemo(() => {
    if (!analiseSelecionada) return { data: null, pacienteGenero: undefined };
    return exameRowToAiData(analiseSelecionada, baseAnalise, terapias, terapiasEditavel, categoriasFiltro);
  }, [analiseSelecionada, baseAnalise, terapias, terapiasEditavel, categoriasFiltro]);

  const analiseMotorRaw = useMemo(() => {
    if (!analiseSelecionada) return undefined;
    if (cacheAnalise[analiseSelecionada.id]) return cacheAnalise[analiseSelecionada.id];
    
    const analise = gerarAnaliseCompleta(analiseSelecionada, baseAnalise, terapias);
    salvarAnaliseCurada(analiseSelecionada.id, analise).then((sucesso) => {
      if (sucesso) console.log(`✅ Análise curada salva: ${analiseSelecionada.id?.substring(0, 5)}`);
    });
    setCacheAnalise(prev => ({ ...prev, [analiseSelecionada.id]: analise }));
    return analise;
  }, [analiseSelecionada, baseAnalise, terapias, cacheAnalise]);

  const analiseMotor = useMemo(() => {
    if (!analiseMotorRaw) return undefined;
    return todasCategoriasSelecionadas 
      ? analiseMotorRaw 
      : filtrarAnalisePorCategoria(analiseMotorRaw, categoriasFiltro);
  }, [analiseMotorRaw, todasCategoriasSelecionadas, categoriasFiltro]);

  // Handlers
  const toggleCategoria = useCallback((cat: CategoriaFiltro) => {
    setCategoriasFiltro(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );
  }, []);

  const estaSelecionado = useCallback((cat: CategoriaFiltro) => 
    todasCategoriasSelecionadas || categoriasFiltro.includes(cat),
  [todasCategoriasSelecionadas, categoriasFiltro]);

  const handleToggleOculta = useCallback((idx: string) => {
    setTerapiasOcultas(prev => {
      const novo = new Set(prev);
      if (novo.has(idx)) novo.delete(idx); else novo.add(idx);
      return novo;
    });
  }, []);

  const recarregarTodosExames = useCallback(async () => {
    try {
      const list = await listarExames();
      setTodosExames(list);
    } catch (e) {
      console.error('Erro ao carregar exames:', e);
    }
  }, []);

  const buscarUltimaAnalise = useCallback(async () => {
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
      setTerapiasOcultas(new Set(list.map((_, i) => String(i))));
      setModalOpen(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao buscar última análise.");
    } finally {
      setLoading(false);
    }
  }, [clientName]);

  const onSelecionarPaciente = useCallback(async (nome: string) => {
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
        (a, b) => new Date(b.data_exame || a.created_at).getTime() - new Date(a.data_exame || a.created_at).getTime()
      );
      setExamesPaciente(listOrdenada);
      setTerapiasOcultas(new Set(listOrdenada.map((_, i) => String(i))));
    } catch (e: unknown) {
      setHistoryError(e instanceof Error ? e.message : "Erro ao carregar exames.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const gerarPdf = useCallback(async (data: RelatorioData | null) => {
    if (!data) return;
    setGerandoPdf(true);
    try {
      await gerarRelatorioPDF(getDataParaPdf(data, terapiasOcultas));
    } catch (e) {
      console.error('Erro ao gerar PDF:', e);
    } finally {
      setGerandoPdf(false);
    }
  }, [terapiasOcultas]);

  // Effects
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalOpen(false);
    };
    if (modalOpen) {
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }
  }, [modalOpen]);

  useEffect(() => {
    let cancelado = false;
    
    async function gerarRelatorio() {
      if (!analiseSelecionada || !analiseResult.data) {
        setRelatorioDataHistorico(null);
        return;
      }
      try {
        const resultado = await buildRelatorioData(
          analiseSelecionada,
          pacienteSelecionado || clientName.trim() || "Cliente",
          analiseResult.data,
          comparativoExamesData,
          analiseMotor,
          categoriasFiltro,
          examesPaciente.filter(e => e.id !== analiseSelecionada?.id),
          analiseResult.pacienteGenero
        );
        if (!cancelado) setRelatorioDataHistorico(resultado);
      } catch (e) {
        console.error('Erro ao gerar relatório:', e);
        if (!cancelado) setRelatorioDataHistorico(null);
      }
    }
    gerarRelatorio();
    return () => { cancelado = true; };
  }, [
    analiseSelecionada, analiseResult.data, pacienteSelecionado, clientName,
    comparativoExamesData, analiseMotor, categoriasFiltro, examesPaciente, analiseResult.pacienteGenero
  ]);

  useEffect(() => {
    (async () => {
      try {
        const [examesData, baseData, terapiasData] = await Promise.all([
          listarExames(),
          listarBaseAnaliseSaude(),
          listarTerapias(),
        ]);
        setTodosExames(examesData);
        setBaseAnalise(baseData);
        setTerapias(terapiasData);
        setTerapiasOcultas(new Set(terapiasData.map((_, i) => String(i))));
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
        await recarregarTodosExames();
        return;
      }
      try {
        const list = await buscarExamesPorNome(q);
        setTodosExames(list);
      } catch { }
    })();
  }, [buscaPacientes, recarregarTodosExames]);

  useEffect(() => {
    if (!existingAnalysisId) return;
    const node = analysisRefs.current[existingAnalysisId];
    if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
    const timeout = window.setTimeout(() => setExistingAnalysisId(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [existingAnalysisId, examesPaciente]);

  // Render helpers
  const renderExameCard = useCallback((a: ExameRow) => {
    const dataRaw = a.data_exame || a.created_at;
    let label = dataRaw;
    try {
      const partes = String(dataRaw).split('T')[0].split('-');
      if (partes.length === 3 && partes[0].length === 4) {
        const d = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
        if (!Number.isNaN(d.getTime())) label = d.toLocaleDateString("pt-BR");
      }
    } catch { /* mantém dataRaw */ }
    
    const scoreMotor = cacheAnalise[a.id] || gerarAnaliseCompleta(a, baseAnalise, terapias);
    const corScore = scoreMotor.scoreGeral >= 85 ? "#22c55e"
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
          <button 
            className="counter" 
            onClick={() => {
              setAnaliseSelecionada(a);
              setTerapiasEditavel("");
              setTerapiasOcultas(new Set(examesPaciente.map((_, i) => String(i))));
              setCategoriasFiltro([]);
              setModalOpen(true);
            }} 
            style={{ marginBottom: 0 }}
            aria-label={`Ver análise de ${label}`}
          >
            Ver
          </button>
          <button
            className="counter"
            onClick={async () => {
              const analiseResult = exameRowToAiData(a, baseAnalise, terapias, terapiasEditavel, categoriasFiltro);
              const dados = await buildRelatorioData(
                a,
                pacienteSelecionado || "Cliente",
                analiseResult.data,
                comparativoExamesData,
                cacheAnalise[a.id] || gerarAnaliseCompleta(a, baseAnalise, terapias),
                categoriasFiltro,
                examesPaciente.filter(e => e.id !== a.id),
                analiseResult.pacienteGenero
              );
              await gerarPdf(dados);
            }}
            disabled={gerandoPdf}
            aria-label={`Baixar PDF de ${label}`}
          >
            {gerandoPdf ? <><span className="mystic-loader"></span> Canalizando...</> : "Baixar PDF"}
          </button>
        </div>
      </div>
    );
  }, [existingAnalysisId, baseAnalise, terapias, cacheAnalise, examesPaciente, pacienteSelecionado, comparativoExamesData, categoriasFiltro, terapiasEditavel, gerandoPdf, gerarPdf]);

  const renderDetalhesAnalise = useCallback(() => {
    if (!analiseSelecionada) return <div style={{ opacity: 0.8 }}>Selecione um exame e clique em "Ver".</div>;
    if (!analiseResult.data) return <div style={{ opacity: 0.8 }}>Não foi possível interpretar este exame.</div>;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>INTERPRETAÇÃO</div>
          <div style={{ whiteSpace: "pre-wrap", lineHeight: "20px" }}>
            {analiseResult.data.interpretacao || "—"}
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>PONTOS CRÍTICOS</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {(analiseResult.data.pontos_criticos ?? []).length
              ? analiseResult.data.pontos_criticos.map((p: string, i: number) => <li key={i}>{p}</li>)
              : <li>—</li>}
          </ul>
        </div>

        {analiseMotor?.matches?.some((m: any) => m.impacto_fitness) && (
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
                    {m.impacto && <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 6 }}>{m.impacto}</div>}
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
          data={analiseResult.data}
          editavel={terapiasEditavel}
          onChangeEditavel={setTerapiasEditavel}
          ocultas={terapiasOcultas}
          onToggleOculta={handleToggleOculta}
        />

        {analiseMotor?.setoresAfetados?.length > 0 && (
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
            🎵 {analiseResult.data.frequencia_lunara || "—"}
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>JUSTIFICATIVA TERAPÊUTICA</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{analiseResult.data.justificativa || "—"}</div>
        </div>

        {relatorioDataHistorico && (
          <button
            id="btn-pdf-lateral"
            className="counter"
            onClick={() => gerarPdf(relatorioDataHistorico)}
            disabled={gerandoPdf}
            style={{ marginBottom: 0 }}
            aria-label="Gerar PDF do relatório"
          >
            Gerar PDF
          </button>
        )}
      </div>
    );
  }, [analiseSelecionada, analiseResult.data, analiseMotor, terapiasEditavel, terapiasOcultas, handleToggleOculta, comparativoExamesData, relatorioDataHistorico, gerandoPdf, gerarPdf]);

  // ============================================================================
  // RENDER PRINCIPAL
  // ============================================================================

  return (
    <>
      <div style={{ display: "flex", minHeight: "100vh", width: "100%" }}>
        {/* Sidebar */}
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
            aria-label="Buscar paciente por nome"
          />
          {historyError && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 10 }}>{historyError}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }} role="list" aria-label="Lista de pacientes">
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
                aria-pressed={pacienteSelecionado === nome}
                role="listitem"
              >
                <div style={{ fontWeight: 700 }}>{nome}</div>
              </button>
            ))}
          </div>
        </aside>

        {/* Main Content */}
        <main style={{ flex: 1, padding: 18 }}>
          {/* Dashboard Cards */}
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
                {/* Lista de Exames */}
                <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontWeight: 800, marginBottom: 10 }}>Exames — {pacienteSelecionado}</div>
                  {historyLoading ? (
                    <div style={{ opacity: 0.8 }}>Carregando...</div>
                  ) : examesPaciente.length === 0 ? (
                    <div style={{ opacity: 0.8 }}>Nenhum exame encontrado.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {examesPaciente.map(renderExameCard)}
                    </div>
                  )}
                </section>

                {/* Detalhes da Análise */}
                <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, minHeight: 220 }}>
                  <div style={{ fontWeight: 800, marginBottom: 10 }}>Detalhes da análise</div>
                  {renderDetalhesAnalise()}
                </section>
              </div>
            </div>
          )}

          <div style={{ height: 20 }} />

          {/* Nova Análise */}
          <section style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, maxWidth: 760 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Nova análise (PDF)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Nome do paciente"
                style={{ padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "inherit" }}
                aria-label="Nome do paciente para nova análise"
              />
              <button className="counter" onClick={buscarUltimaAnalise} disabled={loading} aria-busy={loading}>
                {loading ? "Carregando..." : "Gerar Última Análise"}
              </button>
              {error && <div style={{ color: "#ef4444", fontSize: 14 }} role="alert">{error}</div>}
            </div>
          </section>
        </main>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
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
                <div id="modal-title" style={{ fontWeight: 900, fontSize: 16 }}>
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
                  onClick={() => gerarPdf(relatorioDataHistorico)}
                  disabled={!relatorioDataHistorico || gerandoPdf}
                  style={{ marginBottom: 0 }}
                  aria-busy={gerandoPdf}
                >
                  {gerandoPdf ? <><span className="mystic-loader"></span> Gerando Relatório...</> : "Gerar PDF"}
                </button>
                <button className="counter" onClick={() => setModalOpen(false)} style={{ marginBottom: 0 }} aria-label="Fechar modal">
                  Fechar
                </button>
              </div>
            </div>

            {/* Filtros por Categoria */}
            <div style={{ marginBottom: 16, padding: 12, background: '#1e293b', borderRadius: 8 }}>
              <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.8, fontWeight: 600 }}>📊 Filtrar por categoria:</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="Filtros de categoria">
                {CATEGORIAS_DISPONIVEIS.map(cat => (
                  <label key={cat} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', cursor: 'pointer',
                    borderRadius: 6, fontSize: 12, background: estaSelecionado(cat) ? '#0ea5e9' : '#334155',
                    border: estaSelecionado(cat) ? '1px solid #38bdf8' : '1px solid transparent', transition: 'all 0.2s'
                  }}>
                    <input 
                      type="checkbox" 
                      checked={categoriasFiltro.includes(cat)} 
                      onChange={() => toggleCategoria(cat)}
                      style={{ accentColor: '#0ea5e9', width: 14, height: 14, margin: 0 }}
                      aria-checked={categoriasFiltro.includes(cat)}
                    />
                    <span>{cat === 'emotional' ? 'Emocional' : cat}</span>
                  </label>
                ))}
                {categoriasFiltro.length > 0 && (
                  <button 
                    onClick={() => setCategoriasFiltro([])}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 12, textDecoration: 'underline', marginLeft: 'auto' }}
                    aria-label="Limpar filtros"
                  >
                    Limpar
                  </button>
                )}
              </div>
            </div>

            {/* Conteúdo do Modal */}
            {!analiseSelecionada ? (
              <div style={{ opacity: 0.85 }}>Nenhum exame selecionado.</div>
            ) : !analiseResult.data ? (
              <div style={{ opacity: 0.85 }}>Não foi possível interpretar este exame.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>INTERPRETAÇÃO</div>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: "20px" }}>
                    {analiseResult.data.interpretacao || "—"}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>PONTOS CRÍTICOS</div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {(analiseResult.data.pontos_criticos ?? []).length
                      ? analiseResult.data.pontos_criticos.map((p: string, i: number) => <li key={i}>{p}</li>)
                      : <li>—</li>}
                  </ul>
                </div>

                {analiseMotor?.matches?.some((m: any) => m.impacto_fitness) && (
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
                            {m.impacto && <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 6 }}>{m.impacto}</div>}
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
                  data={analiseResult.data}
                  editavel={terapiasEditavel}
                  onChangeEditavel={setTerapiasEditavel}
                  ocultas={terapiasOcultas}
                  onToggleOculta={handleToggleOculta}
                />

                {analiseMotor?.setoresAfetados?.length > 0 && (
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
                    🎵 {analiseResult.data.frequencia_lunara || "—"}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>JUSTIFICATIVA TERAPÊUTICA</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{analiseResult.data.justificativa || "—"}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default App;