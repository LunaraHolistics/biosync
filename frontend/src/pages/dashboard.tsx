import { jsPDF } from "jspdf";
import { useEffect, useMemo, useState } from "react";
import { listarExames, type ExameRow } from "../services/db";
import ComparativoExamesView from "../components/ComparativoExames";

export default function Dashboard() {
  const [exames, setExames] = useState<ExameRow[]>([]);
  const [selecionado, setSelecionado] = useState<ExameRow | null>(null);

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

  const examesPorPaciente = useMemo(() => {
    const grupos: Record<string, ExameRow[]> = {};

    exames.forEach((exame) => {
      const nome = exame.nome_paciente || "Sem nome";

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

    y += 10;

    if (Array.isArray(plano.terapias) && plano.terapias.length) {
      doc.text("Plano terapêutico:", 10, y);
      y += 8;

      plano.terapias.forEach((t: any) => {
        doc.text(`• ${t.nome}`, 10, y);
        y += 6;

        if (t.descricao) {
          doc.text(`  ${t.descricao}`, 12, y, { maxWidth: 170 });
          y += 6;
        }

        if (t.frequencia) {
          doc.text(`  Frequência: ${t.frequencia}`, 12, y);
          y += 6;
        }

        if (t.justificativa) {
          doc.text(`  ${t.justificativa}`, 12, y, { maxWidth: 170 });
          y += 6;
        }

        y += 4;
      });
    }

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
            <h3 style={{ color: "#38bdf8" }}>{nomePaciente}</h3>

            {examesOrdenados.map((exame, index) => {
              const isMaisRecente = index === 0;

              const dataFormatada = exame.data_exame
                ? new Date(exame.data_exame).toLocaleDateString()
                : "Data inválida";

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
                      boxShadow: isMaisRecente
                        ? "0 0 10px rgba(34,197,94,0.4)"
                        : "none",
                    }}
                  >
                    {isMaisRecente && (
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#22c55e",
                          marginBottom: 4,
                        }}
                      >
                        MAIS RECENTE
                      </div>
                    )}

                    <p style={{ marginBottom: 6 }}>
                      <strong>{dataFormatada}</strong>
                    </p>

                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setSelecionado(exame)}
                      >
                        Ver Análise
                      </button>

                      <button
                        type="button"
                        onClick={() => gerarPDF(exame)}
                      >
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
      {selecionado ? (
        (() => {
          const comparativo =
            (selecionado.analise_ia as any)?.comparativo ?? {
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

              <p>
                <b>Interpretação:</b>
              </p>
              <p>
                {selecionado.analise_ia &&
                typeof selecionado.analise_ia === "object"
                  ? (selecionado.analise_ia as any).interpretacao
                  : null}
              </p>

              <p>
                <b>Pontos Críticos:</b>
              </p>
              <ul>
                {Array.isArray(
                  (selecionado.analise_ia as any)?.pontos_criticos
                )
                  ? (selecionado.analise_ia as any).pontos_criticos.map(
                      (p: string, i: number) => <li key={i}>{p}</li>
                    )
                  : (selecionado.pontos_criticos ?? []).map(
                      (p: string, i: number) => <li key={i}>{p}</li>
                    )}
              </ul>

              {Array.isArray(
                (selecionado.analise_ia as any)?.plano_terapeutico?.terapias
              ) && (
                <>
                  <p>
                    <b>Plano Terapêutico:</b>
                  </p>
                  <ul>
                    {(selecionado.analise_ia as any).plano_terapeutico.terapias.map(
                      (t: any, i: number) => (
                        <li key={i}>
                          <b>{t.nome}</b> — {t.descricao}
                        </li>
                      )
                    )}
                  </ul>
                </>
              )}

              {/* 🔥 COMPARATIVO SEMPRE RENDERIZA */}
              <ComparativoExamesView data={comparativo} />
            </div>
          );
        })()
      ) : null}
    </div>
  );
}