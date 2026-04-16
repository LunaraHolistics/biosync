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
// SEÇÃO PLANO TERAPÊUTICO (COM CHECKBOX E RESTAURAÇÃO)
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
      <div style={{ fontWeight: 900, marginBottom: 6, display: "flex", justifyContent: "space-between" }}>
        <span>PLANO TERAPÊUTICO</span>
        {ocultas && ocultas.size > 0 && <span style={{ fontSize: 11, color: "#f59e0b", fontWeight: 400 }}>{ocultas.size} terapia(s) ocultada(s)</span>}
      </div>

      {p.terapias.length > 0 && (
        <>
          <div style={{ marginBottom: 10, fontSize: 14 }}>
            <b>Periodicidade do plano:</b> {labelPlanoTipo(p.tipo)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {p.terapias.map((item, i: number) => {
              const idx = String(i);
              const isOculta = ocultas?.has(idx) || false;

              // 🔥 NOVO COMPORTAMENTO: SE ESTIVER OCULTA, MOSTRA RISCADA PARA RESTAURAR
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
                      opacity: 0.5,
                      cursor: "pointer",
                      transition: "opacity 0.2s"
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
                      <span style={{ fontSize: 8, opacity: 1, marginTop: 2, color: "#22c55e", fontWeight: 700 }}>Restaurar</span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, textDecoration: "line-through" }}>{item.nome}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>Ocultada do PDF. Clique aqui para reverter.</div>
                    </div>
                  </div>
                );
              }

              // COMPORTAMENTO NORMAL (ATIVA)
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 10,
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: 10,
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
                    <span style={{ fontSize: 8, opacity: 0.5, marginTop: 2 }}>Ocultar</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>{item.nome}</div>
                    <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 6 }}>
                      <b>Frequência:</b> {item.frequencia || "—"}
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: "pre-wrap", marginBottom: 6 }}>
                      {item.descricao || "—"}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                      <b>Justificativa:</b> {item.justificativa || "—"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {onChangeEditavel && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>
            Adicionar/Editar terapias manualmente (será incluído no PDF):
          </div>
          <textarea
            value={editavel}
            onChange={(e) => onChangeEditavel(e.target.value)}
            placeholder="Ex: Acupuntura — Semanal — Para dor e inflamação crônica...
Ozonioterapia — Quinzenal — Para oxigenação tecidual..."
            style={{
              width: "100%",
              minHeight: 100,
              padding: 10,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "inherit",
              fontSize: 13,
              lineHeight: "18px",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        </div>
      )}
    </div>
  );
}

// ==============================
// CONVERSÃO: Motor Novo → AiStructuredData
// ==============================

function exameRowToAiData(
  row: ExameRow,
  base: BaseAnaliseSaudeRow[],
  terapias: TerapiaRow[],
  terapiasManuais?: string
): AiStructuredData {
  const analise = gerarAnaliseCompleta(row, base, terapias);

  const terapiasFormatadas = analise.terapias.map((t) => ({
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

  return {
    interpretacao: analise.interpretacao,
    pontos_criticos: analise.pontosCriticos,
    plano_terapeutico: {
      tipo: "mensal" as const,
      terapias: terapiasFormatadas,
    },
    frequencia_lunara: frequencia_lunara,
    justificativa: `Score: ${analise.scoreGeral}/100 — ${analise.statusScore}. Setores: ${analise.setoresAfetados.join(", ") || "nenhum"}.`,
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

function buildRelatorioData(
  row: ExameRow,
  paciente: string,
  data: AiStructuredData,
  comparacao?: any,
  motor?: AnaliseCompleta
): RelatorioData {
  const meta = resultadoMeta(row);

  return {
    clientName: paciente || "Cliente",
    createdAt: new Date(row.data_exame || row.created_at),
    interpretacao: data.interpretacao || "",
    pontos_criticos: data.pontos_criticos ?? [],
    plano_terapeutico: data.plano_terapeutico,
    frequencia_lunara: data.frequencia_lunara || "",
    justificativa: data.justificativa || "",
    diagnostico: motor ? {
      problemas: motor.matches.map((m) => ({
        sistema: m.categoria,
        item: m.itemBase,
        status: m.gravidade,
        impacto: m.impacto,
        impacto_fitness: (m as any).impacto_fitness || undefined,
      }))
    } : toDiagnostico(meta.diagnostico),
    comparacao,
    relatorio_original_html: getRelatorioOriginal(meta, row),
  };
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
  const [cacheAnalise, setCacheAnalise] = useState<Record<string, AnaliseCompleta>>({});
  const [terapiasEditavel, setTerapiasEditavel] = useState("");
  const [terapiasOcultas, setTerapiasOcultas] = useState<Set<string>>(new Set());
  const [isGerandoPdf, setIsGerandoPdf] = useState(false); // 🔥 ADICIONE ESTE
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

  const analiseSelecionadaData = analiseSelecionada
    ? exameRowToAiData(analiseSelecionada, baseAnalise, terapias, terapiasEditavel)
    : null;

  // 🔥 DECLARAÇÃO ÚNICA E CORRETA AQUI
  const analiseMotor = analiseSelecionada
    ? obterAnalise(analiseSelecionada)
    : undefined;

  // 🔥 DECLARAÇÃO ÚNICA E CORRETA AQUI
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
      analiseMotor
    )
    : null;

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
      setTerapiasOcultas(new Set());
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
    setTerapiasOcultas(new Set());
    try {
      const list = await listarExamesPorPaciente(nome);
      const listOrdenada = [...list].sort(
        (a, b) =>
          new Date(b.data_exame || b.created_at).getTime() -
          new Date(a.data_exame || a.created_at).getTime()
      );
      setExamesPaciente(listOrdenada);
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
                              <button className="counter" onClick={() => { setAnaliseSelecionada(a); setTerapiasEditavel(""); setTerapiasOcultas(new Set()); setModalOpen(true); }} style={{ marginBottom: 0 }}>
                                Ver
                              </button>
                              <button
                                className="counter"
                                onClick={() => {
                                  const data = exameRowToAiData(a, baseAnalise, terapias, terapiasEditavel);
                                  gerarRelatorioPDF(buildRelatorioData(a, pacienteSelecionado || "Cliente", data, comparativoExamesData, obterAnalise(a)));
                                }}
                                style={{ marginBottom: 0 }}
                              >
                                Baixar PDF
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

                      {/* 🔥 NOVO BLOCO: IMPACTO FITNESS NO PREVIEW */}
                      {analiseMotor && analiseMotor.matches.some((m: any) => m.impacto_fitness) && (
                        <div>
                          <div style={{ fontWeight: 900, marginBottom: 8 }}>MAPA TÉCNICO E IMPACTO FITNESS</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {analiseMotor.matches
                              .filter((m: any) => m.impacto_fitness)
                              .slice(0, 10) // Limita a 10 para não poluir a tela
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
                              <span key={s} style={{ background: "var(--border, #1e293b)", padding: "3px 10px", borderRadius: 6, fontSize: 13 }}>{s}</span>
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
                            const btn = document.getElementById('btn-pdf-lateral');
                            if (btn) btn.innerText = "⏳ Gerando PDF...";

                            // 🔥 O SEGREDO: Pinta na tela PRIMEIRO, depois trava no PDF
                            requestAnimationFrame(async () => {
                              try {
                                await gerarRelatorioPDF(getDataParaPdf(relatorioDataHistorico, terapiasOcultas));
                              } catch (e) {
                                console.error(e);
                              } finally {
                                if (btn) btn.innerText = "Baixar PDF";
                              }
                            });
                          }}
                        >
                          Baixar PDF
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
                <div style={{ fontWeight: 900 }}>
                  {(pacienteSelecionado ?? clientName.trim()) || "Paciente"} —{" "}
                  {analiseSelecionada?.data_exame ?? analiseSelecionada?.created_at ?? ""}
                </div>
                {analiseMotor && (
                  <div style={{ fontSize: 13, color: "#38bdf8", marginTop: 2 }}>
                    Score {analiseMotor.scoreGeral}/100 — {analiseMotor.statusScore} |{" "}
                    {analiseMotor.itensAlterados.length} alterados |{" "}
                    {analiseMotor.matches.length} matches |{" "}
                    {analiseMotor.terapias.length} terapias
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  id="btn-pdf-modal"
                  className="counter"
                  onClick={() => {
                    const btn = document.getElementById('btn-pdf-modal');
                    if (btn) btn.innerText = "⏳ Gerando PDF...";

                    requestAnimationFrame(async () => {
                      try {
                        if (relatorioDataHistorico) {
                          await gerarRelatorioPDF(getDataParaPdf(relatorioDataHistorico, terapiasOcultas));
                        }
                      } catch (e) {
                        console.error(e);
                      } finally {
                        if (btn) btn.innerText = "Gerar PDF";
                      }
                    });
                  }}
                  disabled={!relatorioDataHistorico}
                  style={{ marginBottom: 0 }}
                >
                  Gerar PDF
                </button>
                <button className="counter" onClick={() => setModalOpen(false)} style={{ marginBottom: 0 }}>
                  Fechar
                </button>
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

                {/* 🔥 AQUI ESTÁ O IMPACTO FITNESS NO LUGAR CERTO */}
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