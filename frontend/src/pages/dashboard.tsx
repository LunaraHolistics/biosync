import { jsPDF } from "jspdf";
import { useEffect, useState } from "react";
import { listarExames, type ExameRow } from "../services/db";

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

  function gerarPDF(exame: ExameRow) {
    const doc = new jsPDF();

    doc.setFontSize(14);
    doc.text(`Paciente: ${exame.nome_paciente}`, 10, 10);
    doc.text(`Data: ${exame.data_exame}`, 10, 20);

    doc.setFontSize(12);
    doc.text("Interpretação:", 10, 30);

    const texto =
      (exame.analise_ia && typeof exame.analise_ia === "object"
        ? (exame.analise_ia as { interpretacao?: string }).interpretacao
        : undefined) || "Sem dados";
    doc.text(texto, 10, 40, { maxWidth: 180 });

    doc.save(`relatorio-${exame.nome_paciente}.pdf`);
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>BioSync Dashboard</h2>

      {exames.map((exame) => (
        <div
          key={exame.id}
          style={{
            background: "#1e293b",
            color: "white",
            padding: 15,
            marginBottom: 10,
            borderRadius: 8,
          }}
        >
          <h3>{exame.nome_paciente}</h3>
          <p>Data: {exame.data_exame}</p>

          <button type="button" onClick={() => setSelecionado(exame)}>
            Ver Análise
          </button>

          <button type="button" onClick={() => gerarPDF(exame)}>
            PDF
          </button>
        </div>
      ))}

      {selecionado ? (
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
            {selecionado.analise_ia && typeof selecionado.analise_ia === "object"
              ? (selecionado.analise_ia as { interpretacao?: string }).interpretacao
              : null}
          </p>

          <p>
            <b>Pontos Críticos:</b>
          </p>
          <ul>
            {Array.isArray(
              (selecionado.analise_ia as { pontos_criticos?: string[] } | undefined)
                ?.pontos_criticos,
            )
              ? (selecionado.analise_ia as { pontos_criticos: string[] }).pontos_criticos.map(
                  (p: string, i: number) => <li key={i}>{p}</li>,
                )
              : (selecionado.pontos_criticos ?? []).map((p: string, i: number) => (
                  <li key={i}>{p}</li>
                ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
