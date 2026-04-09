import { jsPDF } from "jspdf";
import { useEffect, useMemo, useState } from "react";
import { listarExames, type ExameRow } from "../services/db";
import ComparativoExamesView from "../components/ComparativoExames";
import GraficoEvolucao from "../components/GraficoEvolucao";

export default function Dashboard() {
  const [exames, setExames] = useState<ExameRow[]>([]);
  const [selecionado, setSelecionado] = useState<ExameRow | null>(null);
  const [mostrarGrafico, setMostrarGrafico] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await listarExames();
        if (!cancelled) setExames(data);
      } catch (e) {
        console.error("Erro ao buscar exames:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function formatarPaciente(texto: string) {
    return texto
      .replace(/Sexo:/g, "\nSexo: ")
      .replace(/Idade:/g, "\nIdade: ")
      .replace(/Figura:/g, "\nFigura: ")
      .replace(/Período do teste:/g, "\nPeríodo do teste: ");
  }

  // 🔥 SCORE CLÍNICO
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

  // 🔥 TENDÊNCIA PELO COMPARATIVO
  function calcularTendencia(exame: ExameRow) {
    const comp = (exame.analise_ia as any)?.comparativo;

    if (!comp) return null;

    const score =
      comp.melhoraram.length - comp.pioraram.length;

    if (score > 0) return "Melhora";
    if (score < 0) return "Piora";
    return "Estável";
  }

  const examesPorPaciente = useMemo(() => {
    const grupos: Record<string, ExameRow[]> = {};

    exames.forEach((exame) => {
      const raw = exame.nome_paciente || "Sem nome";
      const nome = raw.split("Sexo")[0].trim();

      if (!grupos[nome]) {
        grupos[nome] = [];
      }

      grupos[nome].push(exame);
    });

    return grupos;
  }, [exames]);

  function gerarPDF(exame: ExameRow) {
    const doc = new jsPDF();

    const analise =
      exame.analise_ia && typeof exame.analise_ia === "object"
        ? (exame.analise_ia as any)
        : {};

    const plano = analise.plano_terapeutico || { terapias: [] };

    let y = 10;

    doc.setFontSize(14);
    doc.text(`Paciente: ${exame.nome_paciente}`, 10, y);
    y += 10;

    doc.text(`Data: ${exame.data_exame}`, 10, y);
    y += 10;

    doc.setFontSize(12);
    doc.text("Interpretação:", 10, y);
    y += 8;

    const interpretacao = analise.interpretacao || "Sem dados";
    doc.text(interpretacao, 10, y, { maxWidth: 180 });
    y += 20;

    doc.text("Pontos críticos:", 10, y);
    y += 8;

    const pontos =
      analise.pontos_criticos || exame.pontos_criticos || [];

    pontos.forEach((p: string) => {
      doc.text(`- ${p}`, 10, y);
      y += 6;
    });

    doc.save(`relatorio-${exame.nome_paciente}.pdf`);
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>BioSync Dashboard</h2>

      {Object.entries(examesPorPaciente).map(([nomePaciente, lista]) => {
        const examesOrdenados = [...lista].sort(
          (a, b) =>
            new Date(b.data_exame).getTime() -
            new Date(a.data_exame).getTime()
        );

        const infoCompleta = lista[0]?.nome_paciente || "";

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
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: "#38bdf8", fontWeight: 700 }}>
                {nomePaciente}
              </div>

              <div style={{ fontSize: 13, opacity: 0.8 }}>
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

              const dataFormatada = exame.data_exame
                ? new Date(exame.data_exame).toLocaleDateString()
                : "Data inválida";

              const { score, status } = calcularScore(exame);
              const tendencia = calcularTendencia(exame);

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
                    alignItems: "flex-start",
                    marginTop: 16,
                  }}
                >
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
                        background: isMaisRecente ? "#22c55e" : "#38bdf8",
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
                      <div style={{ color: "#22c55e", fontSize: 11 }}>
                        MAIS RECENTE
                      </div>
                    )}

                    <p>
                      <strong>{dataFormatada}</strong>
                    </p>

                    {/* 🔥 SCORE */}
                    <div style={{ color: corStatus, fontWeight: 600 }}>
                      {status} — Score {score}
                    </div>

                    {/* 🔥 TENDÊNCIA */}
                    {tendencia && (
                      <div style={{ fontSize: 12, opacity: 0.8 }}>
                        Tendência: {tendencia}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
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
      })}

      {/* 🔥 MODAL */}
      {selecionado && (() => {
        const comparativo =
          (selecionado.analise_ia as any)?.comparativo ?? {
            melhoraram: [],
            pioraram: [],
            novos_problemas: [],
            normalizados: [],
          };

        const nomeBase = (selecionado.nome_paciente || "")
          .split("Sexo")[0]
          .trim();

        const examesPaciente = exames
          .filter(
            (e) =>
              (e.nome_paciente || "").split("Sexo")[0].trim() === nomeBase
          )
          .sort(
            (a, b) =>
              new Date(a.data_exame).getTime() -
              new Date(b.data_exame).getTime()
          );

        // 🔥 GERAR DADOS DO GRÁFICO
        const dadosGrafico = examesPaciente.map((exame) => {
          const analise = (exame.analise_ia as any) || {};

          const pontos =
            analise.pontos_criticos ||
            exame.pontos_criticos ||
            [];

          return {
            data: new Date(exame.data_exame).toLocaleDateString(),
            score: 100 - pontos.length * 5,
          };
        });

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
            <p>{(selecionado.analise_ia as any)?.interpretacao ?? ""}</p>

            <p><b>Pontos Críticos:</b></p>
            <ul>
              {(
                (selecionado.analise_ia as any)?.pontos_criticos ??
                selecionado.pontos_criticos ??
                []
              ).map((p: string, i: number) => (
                <li key={i}>{p}</li>
              ))}
            </ul>

            {/* 🔥 BOTÃO GRÁFICO */}
            <button
              onClick={() => setMostrarGrafico(!mostrarGrafico)}
              style={{ marginTop: 10 }}
            >
              {mostrarGrafico ? "Ocultar evolução" : "Ver evolução"}
            </button>

            {/* 🔥 GRÁFICO CORRETO */}
            {mostrarGrafico && dadosGrafico.length > 1 && (
              <div style={{ marginTop: 20 }}>
                <GraficoEvolucao dados={dadosGrafico} />
              </div>
            )}

            {/* 🔥 COMPARATIVO */}
            <ComparativoExamesView data={comparativo} />
          </div>
        );
      })()}
    </div>
  );
}