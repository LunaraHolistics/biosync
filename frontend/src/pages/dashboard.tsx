import { jsPDF } from "jspdf";
import { useEffect, useMemo, useState } from "react";
import {
  listarExames,
  listarTerapias,
  type ExameRow,
  type TerapiaRow,
  listarBaseAnaliseSaude,
  type BaseAnaliseSaudeRow,
} from "../services/db";

import { gerarComparativoAutomatico } from "../utils/gerarComparativo";
import ComparativoExamesView from "../components/ComparativoExames";
import GraficoEvolucao from "../components/GraficoEvolucao";

export default function Dashboard() {
  const [exames, setExames] = useState<ExameRow[]>([]);
  const [terapias, setTerapias] = useState<TerapiaRow[]>([]);
  const [baseAnalise, setBaseAnalise] = useState<BaseAnaliseSaudeRow[]>([]);
  const [selecionado, setSelecionado] =
    useState<ExameRow | null>(null);
  const [mostrarGrafico, setMostrarGrafico] =
    useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const examesData = await listarExames();
        const terapiasData = await listarTerapias();
        const baseData = await listarBaseAnaliseSaude();

        if (!cancelled) {
          setExames(examesData);
          setTerapias(terapiasData);
          setBaseAnalise(baseData);
        }
      } catch (e) {
        console.error("Erro:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 🔥 ANALISE INTELIGENTE
  function gerarAnaliseInteligente(exame: ExameRow) {
    const pontos =
      exame.pontos_criticos ??
      (exame.analise_ia as any)?.pontos_criticos ??
      [];

    const detalhes = pontos.map((ponto: string) => {
      const match = baseAnalise.find((b) =>
        ponto.toLowerCase().includes(b.item.toLowerCase())
      );

      return {
        item: ponto,
        descricao: match?.descricao_tecnica,
        impacto: match?.impacto,
        setores: match?.setores ?? [],
      };
    });

    const terapiasSugeridas = terapias.filter((t) =>
      detalhes.some((d: any) =>
        d.setores?.some((s: string) =>
          t.tags?.includes(s)
        )
      )
    );

    return {
      interpretacao:
        detalhes
          .map((d: any) => d.descricao)
          .filter(Boolean)
          .join("\n\n") || "Sem interpretação",

      pontos_criticos: pontos,

      terapias: terapiasSugeridas.slice(0, 3),

      comparativo:
        (exame.analise_ia as any)?.comparativo ?? {
          melhoraram: [],
          pioraram: [],
          novos_problemas: [],
          normalizados: [],
        },
    };
  }

  function formatarPaciente(texto: string) {
    return texto
      .replace(/Sexo:/g, "\nSexo: ")
      .replace(/Idade:/g, "\nIdade: ")
      .replace(/Figura:/g, "\nFigura: ")
      .replace(
        /Período do teste:/g,
        "\nPeríodo do teste: "
      );
  }

  function calcularScore(exame: ExameRow) {
    const pontos =
      (exame.analise_ia as any)?.pontos_criticos ??
      exame.pontos_criticos ??
      [];

    const qtd = pontos.length;

    if (qtd === 0) return { score: 90, status: "Ótimo" };
    if (qtd <= 2) return { score: 75, status: "Bom" };
    if (qtd <= 4) return { score: 55, status: "Atenção" };
    return { score: 30, status: "Crítico" };
  }

  function calcularTendencia(exame: ExameRow) {
    const comp = (exame.analise_ia as any)?.comparativo;

    if (!comp) return null;

    const score =
      (comp.melhoraram?.length ?? 0) -
      (comp.pioraram?.length ?? 0);

    if (score > 0) return "Melhora";
    if (score < 0) return "Piora";
    return "Estável";
  }

  const examesPorPaciente = useMemo(() => {
    const grupos: Record<string, ExameRow[]> = {};

    exames.forEach((exame) => {
      const raw = exame.nome_paciente || "Sem nome";
      const nome = String(raw).split("Sexo")[0].trim();

      if (!grupos[nome]) grupos[nome] = [];
      grupos[nome].push(exame);
    });

    return grupos;
  }, [exames]);

  function gerarPDF(exame: ExameRow) {
    const doc = new jsPDF();
    const analise = gerarAnaliseInteligente(exame);

    let y = 10;

    doc.setFontSize(14);
    doc.text(`Paciente: ${exame.nome_paciente}`, 10, y);
    y += 10;

    doc.text(`Data: ${exame.data_exame}`, 10, y);
    y += 10;

    doc.setFontSize(12);
    doc.text("Interpretação:", 10, y);
    y += 8;

    doc.text(analise.interpretacao, 10, y, {
      maxWidth: 180,
    });

    y += 20;

    doc.text("Terapias:", 10, y);
    y += 8;

    analise.terapias.forEach((t) => {
      doc.text(`- ${t.nome}`, 10, y);
      y += 6;
    });

    doc.save(`relatorio-${exame.nome_paciente}.pdf`);
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>BioSync Dashboard</h2>

      {Object.entries(examesPorPaciente).map(
        ([nomePaciente, lista]) => {
          const examesOrdenados = [...lista].sort(
            (a, b) =>
              new Date(b.data_exame).getTime() -
              new Date(a.data_exame).getTime()
          );

          const infoCompleta =
            lista[0]?.nome_paciente || "";

          return (
            <div
              key={nomePaciente}
              style={{
                marginBottom: 20,
                padding: 15,
                background: "#020617",
                borderRadius: 10,
                border: "1px solid #1e293b",
              }}
            >
              {/* HEADER ORIGINAL PRESERVADO */}
              <div style={{ marginBottom: 12 }}>
                <div
                  style={{
                    color: "#38bdf8",
                    fontWeight: 700,
                    fontSize: 16,
                  }}
                >
                  {nomePaciente}
                </div>

                <div
                  style={{
                    fontSize: 13,
                    opacity: 0.8,
                    marginTop: 4,
                    lineHeight: "18px",
                  }}
                >
                  {formatarPaciente(infoCompleta)
                    .split("\n")
                    .slice(1)
                    .map((linha, i) => (
                      <div key={i}>{linha}</div>
                    ))}
                </div>
              </div>

              {examesOrdenados.map((exame, index) => {
                const isMaisRecente = index === 0;

                const dataFormatada = new Date(
                  exame.data_exame
                ).toLocaleDateString();

                const { score, status } =
                  calcularScore(exame);

                const tendencia =
                  calcularTendencia(exame);

                const corStatus =
                  status === "Ótimo"
                    ? "#22c55e"
                    : status === "Bom"
                      ? "#84cc16"
                      : status === "Atenção"
                        ? "#facc15"
                        : "#ef4444";

                return (
                  <div
                    key={exame.id}
                    style={{
                      display: "flex",
                      marginTop: 16,
                    }}
                  >
                    {/* timeline ORIGINAL */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        marginRight: 12,
                      }}
                    >
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          background: isMaisRecente
                            ? "#22c55e"
                            : "#38bdf8",
                        }}
                      />

                      {index !== examesOrdenados.length - 1 && (
                        <div
                          style={{
                            width: 2,
                            flex: 1,
                            minHeight: 40,
                            background: "#334155",
                            marginTop: 2,
                          }}
                        />
                      )}
                    </div>

                    {/* card ORIGINAL */}
                    <div
                      style={{
                        background: "#1e293b",
                        color: "white",
                        padding: 12,
                        borderRadius: 8,
                        flex: 1,
                        border: isMaisRecente
                          ? "2px solid #22c55e"
                          : "1px solid #1e293b",
                      }}
                    >
                      {isMaisRecente && (
                        <div
                          style={{
                            color: "#22c55e",
                            fontSize: 11,
                            marginBottom: 4,
                          }}
                        >
                          MAIS RECENTE
                        </div>
                      )}

                      <p>
                        <strong>{dataFormatada}</strong>
                      </p>

                      <div
                        style={{
                          color: corStatus,
                          fontWeight: 600,
                        }}
                      >
                        {status} — Score {score}
                      </div>

                      {tendencia && (
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                          Tendência: {tendencia}
                        </div>
                      )}

                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          marginTop: 6,
                        }}
                      >
                        <button
                          onClick={() => {
                            setSelecionado(exame);
                            setMostrarGrafico(false);
                          }}
                        >
                          Ver Análise
                        </button>

                        <button onClick={() => gerarPDF(exame)}>
                          PDF
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }
      )}

      {/* 🔥 MODAL */}
      {selecionado && (() => {
        const analise =
          gerarAnaliseInteligente(selecionado);

        const nomeBase = String(
          selecionado.nome_paciente || ""
        )
        String(valor || "")
          .split("Sexo")[0]
          .trim()

        const examesPaciente = exames
          .filter(
            (e) =>
              String(e.nome_paciente || "")
                .split("Sexo")[0]
                .trim() === nomeBase
          )
          .sort(
            (a, b) =>
              new Date(a.data_exame).getTime() -
              new Date(b.data_exame).getTime()
          );

        // 🔥 NOVO: COMPARATIVO AUTOMÁTICO
        const comparativo =
          examesPaciente.length > 1
            ? gerarComparativoAutomatico(examesPaciente)
            : {
              melhoraram: [],
              pioraram: [],
              novos_problemas: [],
              normalizados: [],
            };

        return (
          <div
            style={{
              marginTop: 20,
              padding: 15,
              background: "#0f172a",
              color: "white",
              borderRadius: 8,
            }}
          >
            <h3>Detalhes</h3>

            <p><b>Interpretação:</b></p>
            <p>{analise.interpretacao}</p>

            <p><b>Pontos Críticos:</b></p>
            <ul>
              {analise.pontos_criticos.map((p: string, i: number) => (
                <li key={i}>{p}</li>
              ))}
            </ul>

            <p><b>Terapias:</b></p>
            <ul>
              {analise.terapias.map((t: TerapiaRow) => (
                <li key={t.id}>{t.nome}</li>
              ))}
            </ul>

            <button
              onClick={() =>
                setMostrarGrafico(!mostrarGrafico)
              }
            >
              {mostrarGrafico
                ? "Ocultar evolução"
                : "Ver evolução"}
            </button>

            {mostrarGrafico &&
              examesPaciente.length > 1 && (
                <div style={{ marginTop: 20 }}>
                  <GraficoEvolucao
                    exames={examesPaciente}
                  />
                </div>
              )}

            {/* 🔥 NOVO COMPONENTE */}
            <ComparativoExamesView data={comparativo} />
          </div>
        );
      })()}
    </div>
  );
}