import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { gerarRelatorioPDF, type RelatorioData } from "./services/pdf";
import { processarPdf, type AiStructuredData } from "./services/api";
import { ComparativoExames, type ComparacaoExames } from "./ComparativoExames";
import {
  buscarClientesPorNome,
  contarAnalises,
  contarAnalisesMesAtual,
  contarClientes,
  listarAnalises,
  listarClientes,
  type AnalysisRow,
  type ClientRow,
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

function toDiagnostico(value: unknown): DiagnosticoPdf | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as { problemas?: unknown };
  if (!Array.isArray(obj.problemas)) return undefined;
  const problemas = obj.problemas.filter((p): p is DiagnosticoPdf["problemas"][number] => {
    if (!p || typeof p !== "object") return false;
    const item = p as Record<string, unknown>;
    return (
      typeof item.sistema === "string" &&
      typeof item.item === "string" &&
      typeof item.status === "string" &&
      typeof item.impacto === "string"
    );
  });
  return { problemas };
}

function toComparacao(value: unknown): ComparacaoExames | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const keys = ["melhoraram", "pioraram", "novos_problemas", "normalizados"] as const;
  for (const k of keys) {
    if (!Array.isArray(obj[k])) return undefined;
  }
  return obj as unknown as ComparacaoExames;
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
      (item.status === "baixo" || item.status === "normal" || item.status === "alto")
    );
  });
}

function compararExames(
  atual: ItemProcessado[],
  anterior: ItemProcessado[],
): ComparacaoExames {
  const criarChave = (sistema: string, item: string) => `${sistema}::${item}`;

  const anteriorPorChave = new Map<string, ItemProcessado>();
  const atualPorChave = new Map<string, ItemProcessado>();

  for (const item of anterior) anteriorPorChave.set(criarChave(item.sistema, item.item), item);
  for (const item of atual) atualPorChave.set(criarChave(item.sistema, item.item), item);

  const melhoraram: ComparacaoExames["melhoraram"] = [];
  const pioraram: ComparacaoExames["pioraram"] = [];
  const novos_problemas: ComparacaoExames["novos_problemas"] = [];
  const normalizados: ComparacaoExames["normalizados"] = [];

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

    if (
      (itemAnterior.status === "baixo" || itemAnterior.status === "alto") &&
      itemAtual.status === "normal"
    ) {
      melhoraram.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes: itemAnterior.status,
        depois: itemAtual.status,
        evolucao: "melhora",
      });
      continue;
    }

    if (
      itemAnterior.status === "normal" &&
      (itemAtual.status === "baixo" || itemAtual.status === "alto")
    ) {
      pioraram.push({
        sistema: itemAtual.sistema,
        item: itemAtual.item,
        antes: itemAnterior.status,
        depois: itemAtual.status,
        evolucao: "piora",
      });
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

  return { melhoraram, pioraram, novos_problemas, normalizados };
}

function App() {
  const [clientName, setClientName] = useState("");
  const [clientId, setClientId] = useState("");
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<AiStructuredData | null>(null);
  const [createdAt, setCreatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostico, setDiagnostico] = useState<any | null>(null);
  const [reusedNotice, setReusedNotice] = useState<string | null>(null);
  const [existingAnalysisId, setExistingAnalysisId] = useState<string | null>(null);
  const analysisRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Histórico
  const [clientes, setClientes] = useState<ClientRow[]>([]);
  const [clienteBusca, setClienteBusca] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState<ClientRow | null>(null);
  const [analises, setAnalises] = useState<AnalysisRow[]>([]);
  const [analiseSelecionada, setAnaliseSelecionada] = useState<AnalysisRow | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [dashboard, setDashboard] = useState({
    totalClientes: 0,
    totalAnalises: 0,
    analisesMesAtual: 0,
  });

  const relatorioData: RelatorioData | null = useMemo(() => {
  if (!analysis) return null;

  return {
    clientName: clientName.trim() || "Cliente",
    createdAt: createdAt ?? new Date(),

    interpretacao: analysis.interpretacao ?? "",

    pontos_criticos: Array.isArray(analysis.pontos_criticos)
      ? analysis.pontos_criticos
      : [],

    protocolo: {
      manha: analysis.protocolo?.manha ?? [],
      tarde: analysis.protocolo?.tarde ?? [],
      noite: analysis.protocolo?.noite ?? [],
    },

    frequencia_lunara: analysis.frequencia_lunara ?? "",
    justificativa: analysis.justificativa ?? "",

    // 🔥 NOVO
    diagnostico: diagnostico ?? undefined,
    comparacao: undefined,
  };
}, [analysis, clientName, createdAt, diagnostico]);

  const analiseSelecionadaData: AiStructuredData | null = useMemo(() => {
    const raw = analiseSelecionada?.result_text ?? "";
    if (!raw.trim()) return null;

    const fallback: AiStructuredData = {
      interpretacao: "",
      pontos_criticos: [],
      protocolo: { manha: [], tarde: [], noite: [] },
      frequencia_lunara: "",
      justificativa: "",
    };

    const toStringArray = (v: unknown): string[] => {
      if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
      if (typeof v === "string") return v.trim() ? [v.trim()] : [];
      return [];
    };

    const extractJson = (text: string): string | null => {
      const t = text.trim();
      if (!t) return null;
      if (t.startsWith("{") && t.endsWith("}")) return t;
      const m = t.match(/\{[\s\S]*\}/);
      return m?.[0] ?? null;
    };

    try {
      const candidate = extractJson(raw);
      if (!candidate) return fallback;
      const parsed = JSON.parse(candidate) as any;
      const protocolo = parsed?.protocolo ?? {};
      return {
        interpretacao: typeof parsed?.interpretacao === "string" ? parsed.interpretacao : fallback.interpretacao,
        pontos_criticos: toStringArray(parsed?.pontos_criticos),
        protocolo: {
          manha: toStringArray(protocolo?.manha),
          tarde: toStringArray(protocolo?.tarde),
          noite: toStringArray(protocolo?.noite),
        },
        frequencia_lunara:
          typeof parsed?.frequencia_lunara === "string" ? parsed.frequencia_lunara : fallback.frequencia_lunara,
        justificativa:
          typeof parsed?.justificativa === "string" ? parsed.justificativa : fallback.justificativa,
      };
    } catch {
      return fallback;
    }
  }, [analiseSelecionada]);

  const relatorioDataHistorico: RelatorioData | null = useMemo(() => {
  if (!clienteSelecionado || !analiseSelecionada || !analiseSelecionadaData) return null;

  // Prefer persisted comparacao; otherwise compute from neighboring analysis if possible.
  const idx = analises.findIndex((x) => x.id === analiseSelecionada.id);
  const next = idx >= 0 ? analises[idx + 1] : null; // next = older exam
  const persistedComparacao = toComparacao((analiseSelecionada as any)?.comparacao);
  const computedComparacao =
    !persistedComparacao && next
      ? compararExames(
          toItemProcessadoArray((analiseSelecionada as any)?.dados_processados),
          toItemProcessadoArray((next as any)?.dados_processados),
        )
      : undefined;

  return {
    clientName: clienteSelecionado.name || "Cliente",
    createdAt: analiseSelecionada.created_at || new Date(),

    interpretacao: analiseSelecionadaData.interpretacao ?? "",
    pontos_criticos: analiseSelecionadaData.pontos_criticos ?? [],

    protocolo: {
      manha: analiseSelecionadaData.protocolo?.manha ?? [],
      tarde: analiseSelecionadaData.protocolo?.tarde ?? [],
      noite: analiseSelecionadaData.protocolo?.noite ?? [],
    },

    frequencia_lunara: analiseSelecionadaData.frequencia_lunara ?? "",
    justificativa: analiseSelecionadaData.justificativa ?? "",

    // 🔥 ESSA LINHA É O OURO
    diagnostico: toDiagnostico(analiseSelecionada?.diagnostico),
    comparacao: persistedComparacao ?? computedComparacao,
  };
}, [clienteSelecionado, analiseSelecionada, analiseSelecionadaData, analises]);

  const comparativoExamesData: ComparacaoExames | null = useMemo(() => {
    if (analises.length < 2) return null;
    const atual = toItemProcessadoArray(analises[0]?.dados_processados);
    const anterior = toItemProcessadoArray(analises[1]?.dados_processados);
    if (!atual.length && !anterior.length) return null;
    return compararExames(atual, anterior);
  }, [analises]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setModalOpen(false);
    }
    if (modalOpen) {
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }
  }, [modalOpen]);

  const onProcessarPdf = async () => {
    console.log("🔥 BOTÃO CLICADO");
    console.log("FILES:", pdfFiles);

    if (!pdfFiles || pdfFiles.length === 0) {
      setError("Selecione pelo menos um arquivo.");
      return;
    }

    if (!clientId) {
      setError("Informe o clientId.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await processarPdf(pdfFiles, clientId);

      console.log("RESULTADO:", result);

      setAnalysis(result.data ?? null);
      setDiagnostico(result.diagnostico ?? null);
      setCreatedAt(new Date());

      if (result.reused) {
        setReusedNotice("Este exame já foi analisado anteriormente");
      }

      if (result.analysisId) {
        setExistingAnalysisId(result.analysisId);
      }
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Erro ao processar.");
    } finally {
      setLoading(false);
    }
  };

    setLoading(true);
    try {
      const result = await processarPdf(pdfFiles, clientId); // quando múltiplos
      console.log("RESULTADO COMPLETO:", result);
      setAnalysis(result.data ?? null);
      setDiagnostico(result.diagnostico ?? null);
      setCreatedAt(new Date());
      if (result.reused) {
        setReusedNotice("Este exame já foi analisado anteriormente");
      }
      if (result.analysisId) {
        setExistingAnalysisId(result.analysisId);
      }
      if (clienteSelecionado?.id === clientId) {
        const list = await listarAnalises(clientId);
        setAnalises(list);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao processar PDF.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      setHistoryError(null);
      try {
        const list = await listarClientes();
        setClientes(list);
      } catch (e: unknown) {
        setHistoryError(e instanceof Error ? e.message : "Erro ao carregar clientes.");
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [totalClientes, totalAnalises, analisesMesAtual] = await Promise.all([
          contarClientes(),
          contarAnalises(),
          contarAnalisesMesAtual(),
        ]);
        setDashboard({ totalClientes, totalAnalises, analisesMesAtual });
      } catch {
        // ignore
      }
    })();
  }, [clientes.length, analises.length, loading]);

  useEffect(() => {
    (async () => {
      const q = clienteBusca.trim();
      if (!q) {
        try {
          const list = await listarClientes();
          setClientes(list);
        } catch {
          // ignore
        }
        return;
      }

      try {
        const list = await buscarClientesPorNome(q);
        setClientes(list);
      } catch {
        // ignore
      }
    })();
  }, [clienteBusca]);

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
  }, [existingAnalysisId, analises]);

	async function onSelecionarCliente(c: ClientRow) {
 	 setClienteSelecionado(c);

 	 // 🔥 NOVO: sincroniza com formulário
 	 setClientId(c.id);
 	 setClientName(c.name ?? "");

  	setAnaliseSelecionada(null);
 	 setAnalises([]);
 	 setHistoryError(null);
 	 setHistoryLoading(true);

 	 try {
 	  const list = await listarAnalises(c.id);
  	  setAnalises(list);
 	 } catch (e: unknown) {
 	   setHistoryError(e instanceof Error ? e.message : "Erro ao carregar análises.");
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
            value={clienteBusca}
            onChange={(e) => setClienteBusca(e.target.value)}
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
            {clientes.map((c) => (
              <button
                key={c.id}
                onClick={() => onSelecionarCliente(c)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background:
                    clienteSelecionado?.id === c.id
                      ? "var(--accent-bg)"
                      : "transparent",
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700 }}>{c.name}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{c.id}</div>
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
      ["Total de clientes", dashboard.totalClientes],
      ["Total de análises", dashboard.totalAnalises],
      ["Análises no mês", dashboard.analisesMesAtual],
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

          {!clienteSelecionado ? (
            <div style={{ opacity: 0.8 }}>
              Selecione um cliente à esquerda para ver as análises.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <ComparativoExames comparacao={comparativoExamesData} />
              <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16 }}>
              <section
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 10 }}>
                  Análises — {clienteSelecionado.name}
                </div>
                {historyLoading ? (
                  <div style={{ opacity: 0.8 }}>Carregando...</div>
                ) : analises.length === 0 ? (
                  <div style={{ opacity: 0.8 }}>Nenhuma análise encontrada.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {analises.map((a) => {
                      const date = new Date(a.created_at);
                      const label = Number.isNaN(date.getTime())
                        ? a.created_at
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
                                const extractJson = (text: string): string | null => {
                                  const t = text.trim();
                                  if (!t) return null;
                                  if (t.startsWith("{") && t.endsWith("}")) return t;
                                  const m = t.match(/\{[\s\S]*\}/);
                                  return m?.[0] ?? null;
                                };

                                const toStringArray = (v: unknown): string[] => {
                                  if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
                                  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
                                  return [];
                                };

                                const fallback: AiStructuredData = {
                                  interpretacao: "",
                                  pontos_criticos: [],
                                  protocolo: { manha: [], tarde: [], noite: [] },
                                  frequencia_lunara: "",
                                  justificativa: "",
                                };

                                let parsed: any = null;
                                try {
                                  const candidate = extractJson(a.result_text ?? "");
                                  if (candidate) parsed = JSON.parse(candidate);
                                } catch {
                                  parsed = null;
                                }

                                const protocolo = parsed?.protocolo ?? {};
                                const data: AiStructuredData = parsed
                                  ? {
                                      interpretacao:
                                        typeof parsed.interpretacao === "string" ? parsed.interpretacao : "",
                                      pontos_criticos: toStringArray(parsed.pontos_criticos),
                                      protocolo: {
                                        manha: toStringArray(protocolo.manha),
                                        tarde: toStringArray(protocolo.tarde),
                                        noite: toStringArray(protocolo.noite),
                                      },
                                      frequencia_lunara:
                                        typeof parsed.frequencia_lunara === "string"
                                          ? parsed.frequencia_lunara
                                          : "",
                                      justificativa:
                                        typeof parsed.justificativa === "string" ? parsed.justificativa : "",
                                    }
                                  : fallback;

                                gerarRelatorioPDF({
                                  clientName: clienteSelecionado?.name || "Cliente",
                                  createdAt: a.created_at || new Date(),
                                  interpretacao: data.interpretacao || "",
                                  pontos_criticos: data.pontos_criticos || [],
                                  protocolo: {
                                    manha: data.protocolo?.manha ?? [],
                                    tarde: data.protocolo?.tarde ?? [],
                                    noite: data.protocolo?.noite ?? [],
                                  },
                                  frequencia_lunara: data.frequencia_lunara || "",
                                  justificativa: data.justificativa || "",
                                });
                              }}
                              style={{ marginBottom: 0 }}
                              disabled={!a.result_text?.trim()}
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
                    Selecione uma análise e clique em “Ver”.
                  </div>
                ) : !analiseSelecionadaData ? (
                  <div style={{ opacity: 0.8 }}>
                    Não foi possível interpretar o resultado salvo desta análise.
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
                          analiseSelecionadaData.pontos_criticos.map((p, i) => (
                            <li key={i}>{p}</li>
                          ))
                        ) : (
                          <li>—</li>
                        )}
                      </ul>
                    </div>

                    <div>
                      <div style={{ fontWeight: 900, marginBottom: 6 }}>
                        PROTOCOLO TERAPÊUTICO
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        {(
                          [
                            ["MANHÃ", analiseSelecionadaData.protocolo?.manha ?? []],
                            ["TARDE", analiseSelecionadaData.protocolo?.tarde ?? []],
                            ["NOITE", analiseSelecionadaData.protocolo?.noite ?? []],
                          ] as const
                        ).map(([title, items]) => (
                          <div
                            key={title}
                            style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}
                          >
                            <div style={{ fontWeight: 900, marginBottom: 6 }}>{title}</div>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {items.length ? items.map((x, i) => <li key={i}>{x}</li>) : <li>—</li>}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>

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
                placeholder="Nome do cliente (para o PDF)"
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "inherit",
                }}
              />
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="clientId (Supabase)"
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "inherit",
                }}
              />
              <input
              type="file"
              accept=".pdf,.html,.htm,.txt"
              multiple
              onChange={(e) =>
                setPdfFiles(e.target.files ? Array.from(e.target.files) : [])
              }
            />
              <button className="counter" onClick={onProcessarPdf} disabled={loading}>
                {loading ? "Processando..." : "Processar PDF"}
              </button>
              {error ? <div style={{ color: "#ef4444", fontSize: 14 }}>{error}</div> : null}
              {reusedNotice ? (
                <div style={{ color: "#f59e0b", fontSize: 14, fontWeight: 700 }}>
                  {reusedNotice}
                </div>
              ) : null}

              {relatorioData ? (
                <button className="counter" onClick={() => gerarRelatorioPDF(relatorioData)}>
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
                {clienteSelecionado?.name ?? "Cliente"} —{" "}
                {analiseSelecionada?.created_at ?? ""}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="counter"
                  onClick={() => {
                    if (relatorioDataHistorico) gerarRelatorioPDF(relatorioDataHistorico);
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
              <div style={{ opacity: 0.85 }}>Nenhuma análise selecionada.</div>
            ) : !analiseSelecionadaData ? (
              <div style={{ opacity: 0.85 }}>
                Não foi possível interpretar o resultado salvo desta análise.
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
                      analiseSelecionadaData.pontos_criticos.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))
                    ) : (
                      <li>—</li>
                    )}
                  </ul>
                </div>

                <div>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>
                    PROTOCOLO TERAPÊUTICO
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr",
                      gap: 10,
                    }}
                  >
                    {(
                      [
                        ["MANHÃ", analiseSelecionadaData.protocolo?.manha ?? []],
                        ["TARDE", analiseSelecionadaData.protocolo?.tarde ?? []],
                        ["NOITE", analiseSelecionadaData.protocolo?.noite ?? []],
                      ] as const
                    ).map(([title, items]) => (
                      <div
                        key={title}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 10,
                        }}
                      >
                        <div style={{ fontWeight: 900, marginBottom: 6 }}>
                          {title}
                        </div>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {items.length ? (
                            items.map((x, i) => <li key={i}>{x}</li>)
                          ) : (
                            <li>—</li>
                          )}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>

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
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}

export default App
