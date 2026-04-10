import type { AiStructuredData } from "./services/api";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { gerarRelatorioPDF, type RelatorioData } from "./services/pdf";
import { parsePlanoTerapeutico } from "./services/api";
import ComparativoExamesView from "../ComparativoExames";
import {
  listarExames,
  buscarExamesPorNome,
  contarExames,
  contarExamesMesAtual,
  listarExamesPorPaciente,
  type ExameRow,
} from "./services/db";

type ItemProcessado = {
  sistema: string;
  item: string;
  valor: number;
  min: number;
  max: number;
  status: "baixo" | "normal" | "alto";
};

type DiagnosticoPdf = {
  problemas: {
    sistema: string;
    item: string;
    status: string;
    impacto: string;
    score?: number;
  }[];
};

function resultadoMeta(row: ExameRow): Record<string, unknown> {
  const r = row.resultado_json;
  return r && typeof r === "object" ? (r as Record<string, unknown>) : {};
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

function toComparacao(value: unknown): any {
  if (!value || typeof value !== "object") {
    return {
      melhoraram: [],
      pioraram: [],
      novos_problemas: [],
      normalizados: [],
    };
  }

  const obj = value as Record<string, unknown>;

  return {
    melhoraram: Array.isArray(obj.melhoraram) ? obj.melhoraram : [],
    pioraram: Array.isArray(obj.pioraram) ? obj.pioraram : [],
    novos_problemas: Array.isArray(obj.novos_problemas) ? obj.novos_problemas : [],
    normalizados: Array.isArray(obj.normalizados) ? obj.normalizados : [],
  };
}

function toItemProcessadoArray(value: unknown): ItemProcessado[] {
  if (!Array.isArray(value)) return [];

  return value.filter((x): x is ItemProcessado => {
    if (!x || typeof x !== "object") return false;

    const item = x as Record<string, unknown>;

    return (
      typeof item.sistema === "string" &&
      typeof item.item === "string" &&
      typeof item.valor === "number" &&
      typeof item.min === "number" &&
      typeof item.max === "number" &&
      (item.status === "baixo" ||
        item.status === "normal" ||
        item.status === "alto")
    );
  });
}

function compararExames(
  atual: ItemProcessado[],
  anterior: ItemProcessado[]
): any {
  const criarChave = (sistema: string, item: string) =>
    `${sistema}::${item}`;

  const anteriorPorChave = new Map<string, ItemProcessado>();
  const atualPorChave = new Map<string, ItemProcessado>();

  for (const item of anterior) {
    anteriorPorChave.set(criarChave(item.sistema, item.item), item);
  }

  for (const item of atual) {
    atualPorChave.set(criarChave(item.sistema, item.item), item);
  }

  const melhoraram: any[] = [];
  const pioraram: any[] = [];
  const novos_problemas: any[] = [];
  const normalizados: any[] = [];

  for (const [chave, itemAtual] of atualPorChave.entries()) {
    const itemAnterior = anteriorPorChave.get(chave);

    if (!itemAnterior) {
      novos_problemas.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes: null,
        depois: itemAtual.status,
        evolucao: "novo",
      });
      continue;
    }

    const antes = itemAnterior.status;
    const depois = itemAtual.status;

    if ((antes === "baixo" || antes === "alto") && depois === "normal") {
      melhoraram.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes,
        depois,
        evolucao: "melhora",
      });
      continue;
    }

    if (antes === "normal" && (depois === "baixo" || depois === "alto")) {
      pioraram.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes,
        depois,
        evolucao: "piora",
      });
      continue;
    }
  }

  for (const [chave, itemAnterior] of anteriorPorChave.entries()) {
    if (!atualPorChave.has(chave)) {
      normalizados.push({
        sistema: itemAnterior.sistema,
        item: itemAnterior.item,
        antes: itemAnterior.status,
        depois: null,
        evolucao: "normalizado",
      });
    }
  }

  return {
    melhoraram,
    pioraram,
    novos_problemas,
    normalizados,
  };
}

function labelPlanoTipo(t: AiStructuredData["plano_terapeutico"]["tipo"]): string {
  if (t === "semanal") return "Semanal";
  if (t === "quinzenal") return "Quinzenal";
  return "Mensal";
}

function SecaoPlanoTerapeutico({ data }: { data: AiStructuredData }) {
  const p = data.plano_terapeutico;
  if (!p?.terapias?.length) {
    return (
      <div>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>PLANO TERAPÊUTICO</div>
        <div style={{ opacity: 0.8 }}>Nenhuma terapia sugerida neste exame.</div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>PLANO TERAPÊUTICO</div>
      <div style={{ marginBottom: 10, fontSize: 14 }}>
        <b>Periodicidade do plano:</b> {labelPlanoTipo(p.tipo)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {p.terapias.map((item, i: number) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 10,
            }}
          >
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
        ))}
      </div>
    </div>
  );
}

function exameRowToAiData(row: ExameRow): AiStructuredData {
  const meta = resultadoMeta(row);
  const ia = row.analise_ia;

  const interpretacao =
    typeof ia === "object" && ia && "interpretacao" in ia
      ? String((ia as any).interpretacao || "")
      : "";

  const pontos_criticos =
    typeof ia === "object" && ia && "pontos_criticos" in ia
      ? (ia as any).pontos_criticos ?? row.pontos_criticos ?? []
      : row.pontos_criticos ?? [];

  const plano_terapeutico = parsePlanoTerapeutico(
    typeof ia === "object" && ia && "plano_terapeutico" in ia
      ? (ia as any).plano_terapeutico
      : meta.plano_terapeutico
  );

  const frequencia_lunara =
    typeof ia === "object" && ia && "frequencia_lunara" in ia
      ? String((ia as any).frequencia_lunara || "")
      : "";

  const justificativa =
    typeof ia === "object" && ia && "justificativa" in ia
      ? String((ia as any).justificativa || "")
      : "";

  return {
    interpretacao,
    pontos_criticos,
    plano_terapeutico,
    frequencia_lunara,
    justificativa,
  };
}

function exameTemConteudoParaPdf(row: ExameRow): boolean {
  if (row.pontos_criticos && row.pontos_criticos.length > 0) return true;

  const meta = resultadoMeta(row);
  const plano = parsePlanoTerapeutico(meta.plano_terapeutico);

  if (plano && plano.terapias.length > 0) return true;

  if (row.analise_ia == null) return false;

  if (typeof row.analise_ia === "object") return true;

  return (
    typeof row.analise_ia === "string" &&
    String(row.analise_ia).trim().length > 0
  );
}

function buildRelatorioData(
  row: ExameRow,
  paciente: string,
  data: AiStructuredData,
  comparacao?: any
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

    diagnostico: toDiagnostico(meta.diagnostico),

    comparacao,

    relatorio_original_html: getRelatorioOriginal(meta, row),
  };
}

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

  const analiseSelecionadaData = analiseSelecionada
    ? exameRowToAiData(analiseSelecionada)
    : null;

  // 🔥 CORREÇÃO: vem antes do uso
  const comparativoExamesData = useMemo(() => {
    if (examesPaciente.length < 2) return null;

    const ordenados = [...examesPaciente].sort(
      (a, b) =>
        new Date(b.data_exame || b.created_at).getTime() -
        new Date(a.data_exame || a.created_at).getTime()
    );

    const atualMeta = resultadoMeta(ordenados[0]);
    const anteriorMeta = resultadoMeta(ordenados[1]);

    const atual = toItemProcessadoArray(atualMeta?.dados_processados);
    const anterior = toItemProcessadoArray(anteriorMeta?.dados_processados);

    if (!atual.length || !anterior.length) return null;

    return compararExames(atual, anterior);
  }, [examesPaciente]);

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
      toComparacao(comparativoExamesData)
    )
    : null;

  const relatorioData =
    analiseSelecionada && analiseSelecionadaData
      ? buildRelatorioData(
        analiseSelecionada,
        clientName || "Cliente",
        analiseSelecionadaData
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
        await recarregarTodosExames();
      } catch (e: unknown) {
        setHistoryError(e instanceof Error ? e.message : "Erro ao carregar exames.");
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
        try {
          await recarregarTodosExames();
        } catch { }
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
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    const timeout = window.setTimeout(() => {
      setExistingAnalysisId(null);
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [existingAnalysisId, examesPaciente]);

  async function onSelecionarPaciente(nome: string) {
    setPacienteSelecionado(nome);
    setClientName(nome);

    setAnaliseSelecionada(null);
    setExamesPaciente([]);
    setHistoryError(null);
    setHistoryLoading(true);

    try {
      const list = await listarExamesPorPaciente(nome);

      const listOrdenada = [...list].sort(
        (a, b) =>
          new Date(b.data_exame || b.created_at).getTime() -
          new Date(a.data_exame || a.created_at).getTime()
      );

      setExamesPaciente(listOrdenada);
    } catch (e: unknown) {
      setHistoryError(
        e instanceof Error ? e.message : "Erro ao carregar exames."
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          width: "100%",
        }}
      >
        <aside
          style={{
            width: 300,
            borderRight: "1px solid var(--border)",
            padding: 16,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
            Clientes
          </div>
          <input
            value={buscaPacientes}
            onChange={(e) => setBuscaPacientes(e.target.value)}
            placeholder="Buscar por nome..."
            style={{
              width: "100%",
              padding: 10,
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "inherit",
              marginBottom: 10,
              boxSizing: "border-box",
            }}
          />
          {historyError ? (
            <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 10 }}>
              {historyError}
            </div>
          ) : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {nomesPacientes.map((nome) => (
              <button
                key={nome}
                onClick={() => onSelecionarPaciente(nome)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background:
                    pacienteSelecionado === nome ? "var(--accent-bg)" : "transparent",
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700 }}>{nome}</div>
              </button>
            ))}
          </div>
        </aside>

        <main style={{ flex: 1, padding: 18 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              marginBottom: 20,
            }}
          >
            {(
              [
                ["Total de exames", dashboard.totalExames],
                ["Exames no mês", dashboard.examesMesAtual],
                ["Pacientes (lista atual)", nomesPacientes.length],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 14,
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
                  {label}
                </div>
                <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.1 }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 12 }}>
            Histórico de análises
          </div>

          {!pacienteSelecionado ? (
            <div style={{ opacity: 0.8 }}>
              Selecione um cliente à esquerda para ver os exames.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <ComparativoExamesView data={comparativoExamesData} />
              <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16 }}>
                <section
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 10 }}>
                    Exames — {pacienteSelecionado}
                  </div>
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
                        return (
                          <div
                            key={a.id}
                            ref={(el) => {
                              analysisRefs.current[a.id] = el;
                            }}
                            className={existingAnalysisId === a.id ? "analysis-pulse" : undefined}
                            style={{
                              border:
                                existingAnalysisId === a.id
                                  ? "2px solid #f59e0b"
                                  : "1px solid var(--border)",
                              borderRadius: 10,
                              padding: 10,
                              background:
                                existingAnalysisId === a.id
                                  ? "rgba(245, 158, 11, 0.08)"
                                  : "transparent",
                            }}
                          >
                            <div style={{ fontWeight: 700, marginBottom: 8 }}>
                              {label}
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                className="counter"
                                onClick={() => {
                                  setAnaliseSelecionada(a);
                                  setModalOpen(true);
                                }}
                                style={{ marginBottom: 0 }}
                              >
                                Ver
                              </button>

                              <button
                                className="counter"
                                onClick={() => {
                                  setAnaliseSelecionada(a);

                                  const data = exameRowToAiData(a);

                                  const relatorio = buildRelatorioData(
                                    a,
                                    pacienteSelecionado || "Cliente",
                                    data
                                  );
                                  gerarRelatorioPDF(relatorio);
                                }}
                                style={{ marginBottom: 0 }}
                                disabled={!exameTemConteudoParaPdf(a)}
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

                <section
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 14,
                    minHeight: 220,
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 10 }}>
                    Detalhes da análise
                  </div>
                  {!analiseSelecionada ? (
                    <div style={{ opacity: 0.8 }}>
                      Selecione um exame e clique em “Ver”.
                    </div>
                  ) : !analiseSelecionadaData ? (
                    <div style={{ opacity: 0.8 }}>
                      Não foi possível interpretar o resultado salvo deste exame.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                      <div>
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>
                          INTERPRETAÇÃO
                        </div>
                        <div style={{ whiteSpace: "pre-wrap" }}>
                          {analiseSelecionadaData.interpretacao || "—"}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>
                          PONTOS CRÍTICOS
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {(analiseSelecionadaData.pontos_criticos ?? []).length ? (
                            analiseSelecionadaData.pontos_criticos.map((p: string, i: number) => (
                              <li key={i}>{p}</li>
                            ))
                          ) : (
                            <li>—</li>
                          )}
                        </ul>
                      </div>

                      <SecaoPlanoTerapeutico data={analiseSelecionadaData} />
                      {comparativoExamesData && (
                        <ComparativoExamesView data={toComparacao(comparativoExamesData)} />
                      )}
                      <div className="lunara">
                        <div className="sectionTitle" style={{ marginBottom: 8 }}>
                          Frequência Lunara
                        </div>
                        <div style={{ whiteSpace: "pre-wrap", color: "var(--text-h)" }}>
                          {analiseSelecionadaData.frequencia_lunara || "—"}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>
                          JUSTIFICATIVA TERAPÊUTICA
                        </div>
                        <div style={{ whiteSpace: "pre-wrap" }}>
                          {analiseSelecionadaData.justificativa || "—"}
                        </div>
                      </div>

                      {relatorioDataHistorico ? (
                        <button className="counter" onClick={() => gerarRelatorioPDF(relatorioDataHistorico)}>
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

          <section
            style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 14,
              maxWidth: 760,
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Nova análise (PDF)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Nome do paciente (nome_paciente / PDF)"
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "inherit",
                }}
              />
              <button
                className="counter"
                onClick={buscarUltimaAnalise}
                disabled={loading}
              >
                {loading ? "Carregando..." : "Gerar Última Análise"}
              </button>

              {error ? (
                <div style={{ color: "#ef4444", fontSize: 14 }}>{error}</div>
              ) : null}

              {analiseSelecionadaData ? (
                <div style={{ marginTop: 8 }}>
                  <SecaoPlanoTerapeutico data={analiseSelecionadaData} />
                </div>
              ) : null}

              {relatorioData ? (
                <button
                  className="counter"
                  onClick={() => gerarRelatorioPDF(relatorioData)}
                >
                  Gerar Relatório PDF
                </button>
              ) : null}
            </div>
          </section>
        </main>
      </div>

      {modalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(920px, 96vw)",
              maxHeight: "92vh",
              overflow: "auto",
              background: "rgba(17, 24, 39, 0.98)",
              border: "1px solid var(--border)",
              borderRadius: 14,
              padding: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div style={{ fontWeight: 900 }}>
                {(pacienteSelecionado ?? clientName.trim()) || "Paciente"} —{" "}
                {analiseSelecionada?.data_exame ??
                  analiseSelecionada?.created_at ??
                  ""}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="counter"
                  onClick={() => {
                    if (relatorioDataHistorico)
                      gerarRelatorioPDF(relatorioDataHistorico);
                  }}
                  disabled={!relatorioDataHistorico}
                  style={{ marginBottom: 0 }}
                >
                  Gerar PDF
                </button>
                <button
                  className="counter"
                  onClick={() => setModalOpen(false)}
                  style={{ marginBottom: 0 }}
                >
                  Fechar
                </button>
              </div>
            </div>

            {!analiseSelecionada ? (
              <div style={{ opacity: 0.85 }}>
                Nenhum exame selecionado.
              </div>
            ) : !analiseSelecionadaData ? (
              <div style={{ opacity: 0.85 }}>
                Não foi possível interpretar o resultado salvo deste exame.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>
                    INTERPRETAÇÃO
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>
                    {analiseSelecionadaData.interpretacao || "—"}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>
                    PONTOS CRÍTICOS
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {(analiseSelecionadaData.pontos_criticos ?? []).length ? (
                      analiseSelecionadaData.pontos_criticos.map((p: string, i: number) => (
                        <li key={i}>{p}</li>
                      ))
                    ) : (
                      <li>—</li>
                    )}
                  </ul>
                </div>

                <SecaoPlanoTerapeutico data={analiseSelecionadaData} />

                <div className="lunara">
                  <div className="sectionTitle" style={{ marginBottom: 8 }}>
                    Frequência Lunara
                  </div>
                  <div
                    style={{
                      whiteSpace: "pre-wrap",
                      color: "var(--text-h)",
                    }}
                  >
                    {analiseSelecionadaData.frequencia_lunara || "—"}
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>
                    JUSTIFICATIVA TERAPÊUTICA
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>
                    {analiseSelecionadaData.justificativa || "—"}
                  </div>
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