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

    // 🔥 PONTOS CRÍTICOS
    doc.text("Pontos críticos:", 10, y);
    y += 8;

    const pontos =
      analise.pontos_criticos || exame.pontos_criticos || [];

    pontos.forEach((p: string) => {
      doc.text(`- ${p}`, 10, y);
      y += 6;
    });

    y += 10;

    // 🔥 PLANO TERAPÊUTICO NOVO (SEM MANHÃ/TARDE/NOITE)
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
              (selecionado.analise_ia as any)?.pontos_criticos,
            )
              ? (selecionado.analise_ia as any).pontos_criticos.map(
                  (p: string, i: number) => <li key={i}>{p}</li>,
                )
              : (selecionado.pontos_criticos ?? []).map(
                  (p: string, i: number) => <li key={i}>{p}</li>,
                )}
          </ul>

          {/* 🔥 NOVO PLANO */}
          {Array.isArray(
            (selecionado.analise_ia as any)?.plano_terapeutico?.terapias,
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
                  ),
                )}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}