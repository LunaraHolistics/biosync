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
  type ExameRow,
  type TerapiaRow,
  type BaseAnaliseSaudeRow,
  salvarAnaliseCurada,
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

// 🔥 MAPEAMENTO: categoria → palavras-chave para filtrar texto (expandido)
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

// 🔥 NOVO: Tipo para evolução de itens no PDF
type ItemScoreEvolucao = {
  item: string;
  categoria: string;
  score_atual: number;
  score_anterior: number | null;
  delta: number;
  trend: 'melhorou' | 'piorou' | 'estavel' | 'novo';
  impacto: string;
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
// HELPER NOVO: FILTRAR TERAPIAS OCULTAS NO PDF
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
// 🔥 FUNÇÃO DE FILTRO POR CATEGORIA (CORRIGIDA E ROBUSTA)
// ==============================
function filtrarAnalisePorCategoria(analise: AnaliseCompleta, categoriasFiltro: string[]): AnaliseCompleta {
  if (categoriasFiltro.length === 0) return analise;

  // Coletar todas as palavras-chave dos filtros ativos (incluindo a categoria em si)
  const palavrasChaveAtivas = new Set<string>();
  for (const cat of categoriasFiltro) {
    palavrasChaveAtivas.add(cat.toLowerCase());
    const palavras = PALAVRAS_CHAVE_POR_CATEGORIA[cat] || [];
    palavras.forEach(p => palavrasChaveAtivas.add(p.toLowerCase()));
  }

  // 🔥 Filtrar interpretação: dividir por títulos de seção conhecidos
  let interpretacaoFiltrada = analise.interpretacao;
  if (categoriasFiltro.length > 0) {
    // Extrair introdução (antes do primeiro título)
    const introMatch = analise.interpretacao.match(/^([\s\S]*?)(?=\b(?:MINERAIS|NIVEL DE CONSCIENCIA HUMANA|CARDIOVASCULAR|ACUPUNTURA|ALERGENOS)\b)/i);
    const intro = introMatch?.[1]?.trim() || '';

    // Dividir por títulos de seção (regex com títulos embutidos)
    const regexTitulos = /(?=\b(?:MINERAIS|NIVEL DE CONSCIENCIA HUMANA|CARDIOVASCULAR E CEREBROVASCULAR|ACUPUNTURA|ALERGENOS|COLAGENO|PELE|VITAMINAS|AMINOACIDOS|SISTEMA IMUNOLOGICO|GINECOLOGIA|OLHOS|METAIS PESADOS|SISTEMA ENDOCRINO|PULSO DO CORACAO E CEREBRO|FUNCAO GASTROINTESTINAL|FUNCAO DO FIGADO|COENZIMA|LIPIDIOS SANGUE|LECITINA|FUNCAO DA VESICULA BILIAR|FUNCAO PULMONAR|SISTEMA NERVOSO|DENSIDADE MINERAL OSSEA|DOENCAS OSSEA REUMATOIDE|SEIOS|INDICE DE CRESCIMENTO OSSEO|IMUNIDADE HUMANA|FUNCAO RENAL|DOENCAS OSSEAS|AVALIACAO FISICA BASICA|OBESIDADE|GRANDE FUNCAO DO INTESTINO|TIROIDE|HORMONA MASCULINA|CICLO MENSTRUAL|ACIDO GORDO|FUNCAO PANCREATICA|ACUCAR NO SANGUE|TOXINA HUMANA|ACIDO GORDO ESSENCIAL|FUNCAO RESPIRATORIA|FUNCAO SEXUAL MASCULINA)\b)/i;

    const secoesRaw = analise.interpretacao.split(regexTitulos);

    // Filtrar seções que contêm palavras-chave dos filtros ativos
    const secoesFiltradas = secoesRaw.filter(secao => {
      if (!secao.trim()) return false;
      // Extrair título da seção (primeira palavra em maiúsculas)
      const tituloMatch = secao.match(/^\b([A-ZÀ-Ú][A-ZÀ-Ú\s]+)\b/);
      const titulo = tituloMatch?.[1]?.trim() || '';

      // Manter se o título OU o conteúdo contiver palavra-chave ativa
      const textoLower = secao.toLowerCase();
      const corresponde = categoriasFiltro.some(cat => {
        const palavras = PALAVRAS_CHAVE_POR_CATEGORIA[cat] || [];
        return titulo.toLowerCase().includes(cat) ||
          palavras.some(p => textoLower.includes(p.toLowerCase()));
      });

      return corresponde;
    });

    // Extrair conclusão (último parágrafo com "Conclusao" ou "Recomenda-se")
    const conclusaoMatch = analise.interpretacao.match(/(Conclusao[\s\S]*$)/i);
    const conclusao = conclusaoMatch?.[1]?.trim() || '';

    // Montar interpretação filtrada
    const partes = [];
    if (intro) partes.push(intro);
    if (secoesFiltradas.length > 0) partes.push(...secoesFiltradas);
    if (conclusao) partes.push(conclusao);

    interpretacaoFiltrada = partes.join('\n\n').trim() || analise.interpretacao;
  }

  // 🔥 Filtrar pontos críticos: manter apenas os que correspondem às categorias
  const pontosCriticosFiltrados = analise.pontosCriticos.filter((p: string) => {
    // Extrair item (antes dos dois pontos) para filtragem mais precisa
    const itemMatch = p.match(/^·?\s*([^:：]+):/);
    const item = itemMatch?.[1]?.trim() || p;

    return categoriasFiltro.some(cat => {
      const palavras = PALAVRAS_CHAVE_POR_CATEGORIA[cat] || [];
      const textoLower = p.toLowerCase();
      const itemLower = item.toLowerCase();
      // Filtrar se a categoria, o item ou qualquer palavra-chave estiver presente
      return itemLower.includes(cat) ||
        palavras.some(palavra => textoLower.includes(palavra) || itemLower.includes(palavra));
    });
  });

  // 🔥 Filtrar matches por categoria exata
  const matchesFiltrados = analise.matches.filter((m: any) => categoriasFiltro.includes(m.categoria));

  // 🔥 Filtrar terapias por categoria ou tags
  const terapiasFiltradas = analise.terapias.filter((t: any) => {
    const tags = [t.categoria, ...(t.tags || [])].filter(Boolean);
    return tags.some((tag: string) => categoriasFiltro.includes(tag.toLowerCase()));
  });

  // 🔥 Filtrar setores afetados
  const setoresFiltrados = analise.setoresAfetados.filter((s: string) => categoriasFiltro.includes(s.toLowerCase()));

  return {
    ...analise,
    interpretacao: interpretacaoFiltrada,
    // 🔥 Fallback inteligente: se nenhum ponto crítico passar, mostra mensagem indicando filtragem
    pontosCriticos: pontosCriticosFiltrados.length > 0
      ? pontosCriticosFiltrados
      : ['Nenhum ponto crítico identificado para as categorias selecionadas.'],
    matches: matchesFiltrados,
    terapias: terapiasFiltradas,
    setoresAfetados: setoresFiltrados
  };
}

// 🔥 NOVO: CÁLCULO DE EVOLUÇÃO ENTRE EXAMES
// ==============================

function calcularTendenciaItem(scoreAtual: number, scoreAnterior: number | null): 'melhorou' | 'piorou' | 'estavel' | 'novo' {
  if (scoreAnterior === null) return 'novo';
  const delta = scoreAtual - scoreAnterior;
  if (delta >= 10) return 'melhorou';
  if (delta <= -10) return 'piorou';
  return 'estavel';
}

function gerarItemScoresComEvolucao(
  itensAtuais: Array<{ item: string; categoria: string; score?: number; impacto: string }>,
  examesAnteriores: ExameRow[]
): ItemScoreEvolucao[] {
  // Busca o exame anterior mais recente que tenha item_scores
  const exameAnterior = examesAnteriores
    .filter(e => e.indice_biosync?.item_scores && Array.isArray(e.indice_biosync.item_scores))
    .sort((a, b) => new Date(b.data_exame || b.created_at).getTime() - new Date(a.data_exame || b.created_at).getTime())[0];

  // ✅ Se não houver exame anterior com scores, retorna itens atuais sem comparação
  if (!exameAnterior) {
    return itensAtuais.map(atual => ({
      item: atual.item,
      categoria: atual.categoria,
      score_atual: atual.score ?? 50,
      score_anterior: null,
      delta: 0,
      trend: 'novo' as const,
      impacto: atual.impacto
    }));
  }

  const itensAnteriores = (exameAnterior?.indice_biosync?.item_scores as ItemScoreEvolucao[] | undefined) || [];
  const mapaAnterior = new Map(itensAnteriores.map((i: ItemScoreEvolucao) => [i.item.toLowerCase(), i]));

  return itensAtuais.map(atual => {
    const chave = atual.item.toLowerCase();
    const anterior = mapaAnterior.get(chave);
    const scoreAtual = atual.score ?? 50;
    const scoreAnterior = anterior?.score_atual ?? null;
    const delta = scoreAnterior !== null ? scoreAtual - scoreAnterior : 0;
    const trend = calcularTendenciaItem(scoreAtual, scoreAnterior);

    return {
      item: atual.item,
      categoria: atual.categoria,
      score_atual: scoreAtual,
      score_anterior: scoreAnterior,
      delta,
      trend,
      impacto: atual.impacto
    };
  });
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
// SEÇÃO PLANO TERAPÊUTICO (COM CHECKBOX E RESTAURAÇÃO)
// ==============================

function SecaoPlanoTerapeutico({ data, editavel, onChangeEditavel, ocultas, onToggleOculta }: {
  data: AiStructuredData;  // ← ✅ CORREÇÃO: nome da prop primeiro, tipo depois
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
                      display: "flex",
                      gap: 10,
                      border: "1px dashed #475569",
                      borderRadius: 10,
                      padding: 10,
                      opacity: 0.6,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      background: "rgba(71, 85, 105, 0.05)"
                    }}
                    title="Clique para restaurar esta terapia ao PDF"
                  >
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", paddingTop: 2 }}>
                      <input
                        type="checkbox"
                        checked={true}
                        readOnly
                        style={{ cursor: "pointer", accentColor: "#22c55e", width: 16, height: 16 }}
                      />
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
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 10,
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 12,
                    background: "rgba(255,255,255,0.02)",
                    transition: "border-color 0.2s"
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", paddingTop: 2 }}>
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => onToggleOculta?.(idx)}
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
              width: "100%",
              minHeight: 100,
              padding: 10,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "rgba(15, 23, 42, 0.5)",
              color: "inherit",
              fontSize: 12,
              lineHeight: "18px",
              resize: "vertical",
              boxSizing: "border-box",
              fontFamily: "monospace"
            }}
          />
        </div>
      )}
    </div>
  );
}

// ==============================
// 🔥 CONVERSÃO: Motor Novo → AiStructuredData COM FILTROS + GÊNERO
// ==============================

function exameRowToAiData(
  row: ExameRow,
  base: BaseAnaliseSaudeRow[],
  terapias: TerapiaRow[],
  terapiasManuais?: string,
  filtrosAtivos?: string[]
): { data: AiStructuredData; pacienteGenero?: 'masculino' | 'feminino' } {  // ← ✅ CORREÇÃO: nome da prop primeiro
  const analiseRaw = gerarAnaliseCompleta(row, base, terapias);

  // 🔥 APLICA FILTROS NA ANÁLISE ANTES DE CONVERTER
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
    const linhas = terapiasManuais
      .split("\n")
      .filter((l) => l.trim().length > 0);

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

  // 🔥 CORREÇÃO: Justificativa mostra apenas setores filtrados
  const setoresParaJustificativa = filtrosAtivos?.length && filtrosAtivos.length > 0
    ? analise.setoresAfetados.filter(s => filtrosAtivos.includes(s.toLowerCase()))
    : analise.setoresAfetados;

  // 🔥 Extrair gênero do paciente para filtragem no PDF
  const pacienteGenero = extrairGeneroPaciente(row.nome_paciente);

  // ✅ CORREÇÃO: Retornar objeto com propriedades nomeadas
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

  return { data: analiseData, pacienteGenero };  // ← ✅ CORREÇÃO: nome da prop primeiro
}

// ==============================
// 🔥 FUNÇÃO buildRelatorioData ATUALIZADA COM item_scores, EVOLUÇÃO E GÊNERO
// ==============================
function buildRelatorioData(
  row: ExameRow,
  paciente: string,
  data: AiStructuredData,
  comparacao?: any,
  motor?: AnaliseCompleta,
  filtrosAtivos?: string[],
  examesAnteriores?: ExameRow[],
  pacienteGenero?: 'masculino' | 'feminino'
): RelatorioData {
  const meta = resultadoMeta(row);

  // 🔥 Calcula item_scores com evolução se houver exames anteriores
  let itemScoresEvolucao: ItemScoreEvolucao[] | undefined;
  
  // Verificar se motor tem matches COM scores
  if (motor?.matches && motor.matches.length > 0) {
    console.log('📊 [buildRelatorioData] Motor matches:', motor.matches.length);
    console.log('📊 [buildRelatorioData] Amostra:', motor.matches.slice(0, 2));
    
    const itensAtuais = motor.matches.map((m: any) => ({
      item: m.itemBase,
      categoria: m.categoria,
      score: m.score ?? 50,  // ← Aqui deve vir o score calculado!
      impacto: m.impacto || 'Desequilíbrio bioenergético identificado'
    }));
    
    itemScoresEvolucao = gerarItemScoresComEvolucao(itensAtuais, examesAnteriores || []);
    
    console.log('📊 [buildRelatorioData] item_scores gerados:', itemScoresEvolucao?.length);
    console.log('📊 [buildRelatorioData] Amostra:', itemScoresEvolucao?.slice(0, 2));
  } else {
    console.warn('⚠️ [buildRelatorioData] motor.matches vazio ou undefined');
  }

  return {
    clientName: paciente || "Cliente",
    createdAt: new Date(row.data_exame || row.created_at),
    interpretacao: data.interpretacao || "",
    pontos_criticos: data.pontos_criticos ?? [],
    plano_terapeutico: data.plano_terapeutico,
    frequencia_lunara: data.frequencia_lunara || "",
    justificativa: data.justificativa || "",
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
    // 🔥 NOVO: item_scores com evolução para tabela no PDF
    item_scores: itemScoresEvolucao,
    // 🔥 NOVO: Gênero do paciente para filtragem no PDF
    pacienteGenero
  };
}

// ✅ CORREÇÃO: Esta declaração FORA da função App() foi REMOVIDA para evitar erro de escopo
// A declaração correta está DENTRO da função App() abaixo

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
  // ✅ CORREÇÃO: categoriasFiltro declarado APENAS UMA VEZ
  const [categoriasFiltro, setCategoriasFiltro] = useState<string[]>([]);
  const todasCategoriasSelecionadas = categoriasFiltro.length === 0;
  const [cacheAnalise, setCacheAnalise] = useState<Record<string, AnaliseCompleta>>({});
  const [terapiasEditavel, setTerapiasEditavel] = useState("");
  const [gerandoPdf, setGerandoPdf] = useState(false);

  // 🔥 TERAPIAS OCULTAS: começa COM TODAS MARCADAS (ocultas por padrão)
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

  // 🔥 CORREÇÃO: analiseSelecionadaData declarado DENTRO da função App() (CORRETO)
  const analiseResult = analiseSelecionada
    ? exameRowToAiData(analiseSelecionada, baseAnalise, terapias, terapiasEditavel, categoriasFiltro)
    : { data: null, pacienteGenero: undefined };  // ← ✅ CORREÇÃO: nome da prop 'data'

  const analiseSelecionadaData = analiseResult.data;  // ← ✅ CORREÇÃO: acessar .data
  const generoSelecionado = analiseResult.pacienteGenero;

  const analiseMotorRaw = analiseSelecionada
    ? obterAnalise(analiseSelecionada)
    : undefined;

  // 🔥 APLICA FILTRO À ANÁLISE (para Mapa Técnico)
  const analiseMotor = analiseMotorRaw && !todasCategoriasSelecionadas
    ? filtrarAnalisePorCategoria(analiseMotorRaw, categoriasFiltro)
    : analiseMotorRaw;

  // 🔥 PASSA categoriasFiltro, examesAnteriores E pacienteGenero PARA buildRelatorioData

  const relatorioDataHistorico = analiseSelecionada
    ? buildRelatorioData(
      analiseSelecionada,
      pacienteSelecionado || clientName.trim() || "Cliente",
      analiseSelecionadaData ?? {
        interpretacao: "",
        pontos_criticos: [],
        plano_terapeutico: { tipo: "mensal", terapias: [] },
        frequencia_lunara: "",
        justificativa: "",
      },
      comparativoExamesData,
      analiseMotor,
      categoriasFiltro,
      examesPaciente.filter(e => e.id !== analiseSelecionada?.id),
      generoSelecionado
    )
    : null;

  // 🔥 DEBUG: Verificar se item_scores estão sendo gerados
  if (relatorioDataHistorico) {
    console.log('📊 [DEBUG] relatorioDataHistorico.item_scores:', {
      count: relatorioDataHistorico.item_scores?.length || 0,
      amostra: relatorioDataHistorico.item_scores?.slice(0, 3),
      analiseMotorMatches: analiseMotor?.matches?.length || 0,
      examesAnteriores: examesPaciente.filter(e => e.id !== analiseSelecionada?.id).length
    });

    // Verificar se matches têm scores
    if (analiseMotor?.matches) {
      const matchesComScore = analiseMotor.matches.filter(m => m.score !== undefined && m.score !== null);
      console.log('📊 [DEBUG] Matches com score:', `${matchesComScore.length}/${analiseMotor.matches.length}`);
      console.log('📊 [DEBUG] Amostra de matches:', analiseMotor.matches.slice(0, 3));
    }
  }

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
                        const date = new Date(a.data_exame || a.created_at);
                        const label = Number.isNaN(date.getTime())
                          ? a.data_exame || a.created_at
                          : date.toLocaleString();
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
                                onClick={() => {
                                  setGerandoPdf(true);

                                  // 🔥 LOGS DE DEBUG - ABRA O CONSOLE DO NAVEGADOR (F12)
                                  console.log('🔍 [DEBUG] Filtros ativos:', categoriasFiltro);
                                  console.log('🔍 [DEBUG] Pontos críticos filtrados:', analiseSelecionadaData?.pontos_criticos);
                                  console.log('🔍 [DEBUG] Setores filtrados:', analiseMotor?.setoresAfetados);
                                  console.log('🔍 [DEBUG] Matches filtrados:', analiseMotor?.matches?.map(m => m.categoria));

                                  const analiseResult = exameRowToAiData(a, baseAnalise, terapias, terapiasEditavel, categoriasFiltro);
                                  gerarRelatorioPDF(buildRelatorioData(a, pacienteSelecionado || "Cliente", analiseResult.data, comparativoExamesData, obterAnalise(a), categoriasFiltro, examesPaciente.filter(e => e.id !== a.id), analiseResult.pacienteGenero));
                                  setTimeout(() => setGerandoPdf(false), 3000);
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
                        data={analiseSelecionadaData}  // ← ✅ CORREÇÃO: prop 'data'
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
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontWeight: 700,
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
                  data={analiseSelecionadaData}  // ← ✅ CORREÇÃO: prop 'data'
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