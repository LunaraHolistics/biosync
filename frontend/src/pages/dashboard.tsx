import jsPDF from "jspdf";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Exame = {
    id: string;
    nome_paciente: string;
    data_exame: string;
    status: string;
    analise_ia: any;
};

export default function Dashboard() {
    const [exames, setExames] = useState<Exame[]>([]);
    const [selecionado, setSelecionado] = useState<Exame | null>(null);

    useEffect(() => {
        buscarExames();
    }, []);

    async function buscarExames() {
        const { data, error } = await supabase
            .from("exames")
            .select("*")
            .order("data_exame", { ascending: false });

        if (error) {
            console.error("Erro ao buscar exames:", error);
        } else {
            setExames(data || []);
        }
    }

    function gerarPDF(exame: Exame) {
        const doc = new jsPDF();

        doc.setFontSize(14);
        doc.text(`Paciente: ${exame.nome_paciente}`, 10, 10);
        doc.text(`Data: ${exame.data_exame}`, 10, 20);

        doc.setFontSize(12);
        doc.text("Interpretação:", 10, 30);

        const texto = exame.analise_ia?.interpretacao || "Sem dados";
        doc.text(texto, 10, 40, { maxWidth: 180 });

        doc.save(`relatorio-${exame.nome_paciente}.pdf`);
    }

    return (
        <div style={{ padding: 20 }}>
            <h2>📊 BioSync Dashboard</h2>

            {exames.map((exame) => (
                <div key={exame.id} style={{
                    background: "#1e293b",
                    color: "white",
                    padding: 15,
                    marginBottom: 10,
                    borderRadius: 8
                }}>
                    <h3>{exame.nome_paciente}</h3>
                    <p>Data: {exame.data_exame}</p>
                    <p>Status: {exame.status}</p>

                    <button onClick={() => setSelecionado(exame)}>
                        Ver Análise
                    </button>

                    <button onClick={() => gerarPDF(exame)}>
                        📄 PDF
                    </button>
                </div>
            ))}

            {selecionado && (
                <div style={{
                    marginTop: 20,
                    padding: 15,
                    background: "#0f172a",
                    color: "white",
                    borderRadius: 8
                }}>
                    <h3>🔍 Detalhes</h3>

                    <p><b>Interpretação:</b></p>
                    <p>{selecionado.analise_ia?.interpretacao}</p>

                    <p><b>Pontos Críticos:</b></p>
                    <ul>
                        {selecionado.analise_ia?.pontos_criticos?.map((p: string, i: number) => (
                            <li key={i}>{p}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}