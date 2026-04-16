import { useEffect, useMemo, useState } from "react";
import {
  listarExames,
  listarTerapias,
  type ExameRow,
  type TerapiaRow,
  listarBaseAnaliseSaude,
  type BaseAnaliseSaudeRow,
} from "../services/db";

import {
  gerarAnaliseCompleta,
  gerarComparativoInteligente,
  calcularScoreGeral,
  extrairItensAlterados,
  decodificarMojibake,
  normalizarTexto,
  parsearPaciente,
  type AnaliseCompleta,
} from "../lib/motorSemantico";

// 🔥 EVOLUÇÃO 1: Removido o jsPDF bruto e importado o seu gerador profissional
import { gerarRelatorioPDF, type RelatorioData } from "../services/pdf";

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

  // Cache de análises por exame.id
  const [cacheAnalise, setCacheAnalise] = useState<
    Record<string, AnaliseCompleta>
  >({});

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

  // 🔥 ANÁLISE INTELIGENTE COM CACHE
  function obterAnalise(exame: ExameRow): AnaliseCompleta {
    if (cacheAnalise[exame.id]) return cacheAnalise[exame.id];

    const analise = gerarAnaliseCompleta(
      exame,
      baseAnalise,
      terapias
    );

    setCacheAnalise((prev) => ({
      ...prev,
      [exame.id]: analise,
    }));

    return analise;
  }

  // 🔥 EXTRAIR NOME LIMPO (robusto contra mojibake e variações)
  function extrairNomeLimpo(nomePaciente: string): string {
    const decodificado = decodificarMojibake(nomePaciente);
    const normalizado = normalizarTexto(decodificado);
    const nome = normalizado.split("sexo")[0].trim();
    return nome;
  }

  function calcularScore(exame: ExameRow) {
    const itens = extrairItensAlterados(
      exame.resultado_json
    );
    return calcularScoreGeral(itens);
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

  // 🔥 AGRUPAMENTO ROBUSTO (normaliza antes de agrupar)
  const examesPorPaciente = useMemo(() => {
    const grupos: Record<string, ExameRow[]> = {};

    exames.forEach((exame) => {
      const raw = exame.nome_paciente || "Sem nome";
      const nome = extrairNomeLimpo(raw);

      if (!nome) return;

      if (!grupos[nome]) grupos[nome] = [];
      grupos[nome].push(exame);
    });

    return grupos;
  }, [exames]);

  // 🔥 EVOLUÇÃO 2: Função gerarPDF reescrita para usar seu pdf.ts comImpacto e Solfeggio
  async function gerarPDF(exame: ExameRow) {
    const analise = obterAnalise(exame);

    // Mapeando o que o Motor gerou para o formato exato que o pdf.ts exige
    const dadosParaPDF: RelatorioData = {
      clientName: analise.paciente.nome,
      createdAt: exame.data_exame,
      interpretacao: analise.interpretacao,
      pontos_criticos: analise.pontosCriticos,

      // Mapeamento do Impacto Fitness
      diagnostico: {
        problemas: analise.matches.map((m) => ({
          sistema: m.categoria,
          item: m.itemBase,
          status: m.gravidade,
          impacto: m.impacto,
          impacto_fitness: m.impacto_fitness || undefined,
        })),
      },

      // Mapeamento das Terapias
      plano_terapeutico: {
        terapias: analise.terapias.map((t) => ({
          nome: t.nome,
          descricao: t.descricao,
          frequencia: t.frequencia,
          justificativa: t.motivos?.join(", "), // Junta os motivos gerados pelo motor
        })),
      },

      // 🔥 AQUI ESTÁ A SOLUÇÃO DO TRAÇO: Puxando direto do Motor Semântico
      frequencia_lunara: analise.frequencia_lunara,

      justificativa: `Score: ${analise.scoreGeral}/100 — ${analise.statusScore}. Setores: ${analise.setoresAfetados.join(", ")}.`,
    };

    // Chama a função do pdf.ts que não corta texto e tem formatação
    await gerarRelatorioPDF(dadosParaPDF);
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

          const infoCompleta = lista[0]?.nome_paciente || "";
          const paciente = parsearPaciente(infoCompleta);

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
              {/* 🔥 HEADER COM BADGES SEPARADOS */}
              <div style={{ marginBottom: 12 }}>
                <div
                  style={{
                    color: "#38bdf8",
                    fontWeight: 700,
                    fontSize: 16,
                  }}
                >
                  {paciente.nome || nomePaciente}
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginTop: 6,
                    flexWrap: "wrap",
                  }}
                >
                  {paciente.sexo && (
                    <span
                      style={{
                        fontSize: 13,
                        opacity: 0.8,
                        background: "#1e293b",
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {paciente.sexo}
                    </span>
                  )}
                  {paciente.idade && (
                    <span
                      style={{
                        fontSize: 13,
                        opacity: 0.8,
                        background: "#1e293b",
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {paciente.idade} anos
                    </span>
                  )}
                  {paciente.figura && (
                    <span
                      style={{
                        fontSize: 13,
                        opacity: 0.8,
                        background: "#1e293b",
                        padding: "2px 8px",
                        borderRadius: 4,
                      }}
                    >
                      {paciente.figura}
                    </span>
                  )}
                  {paciente.periodoTeste && (
                    <span
                      style={{
                        fontSize: 12,
                        opacity: 0.6,
                      }}
                    >
                      Teste: {paciente.periodoTeste}
                    </span>
                  )}
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
                        : status === "Cuidado"
                          ? "#f97316"
                          : "#ef4444";

                return (
                  <div
                    key={exame.id}
                    style={{
                      display: "flex",
                      marginTop: 16,
                    }}
                  >
                    {/* timeline */}
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

                    {/* card */}
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
                        <div
                          style={{
                            fontSize: 12,
                            opacity: 0.8,
                          }}
                        >
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

                        <button
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
        }
      )}

      {/* 🔥 MODAL */}
      {selecionado && (() => {
        const analise = obterAnalise(selecionado);

        const nomeBase = extrairNomeLimpo(
          selecionado.nome_paciente || ""
        );

        const examesPaciente = exames
          .filter(
            (e) =>
              extrairNomeLimpo(
                e.nome_paciente || ""
              ) === nomeBase
          )
          .sort(
            (a, b) =>
              new Date(a.data_exame).getTime() -
              new Date(b.data_exame).getTime()
          );

        const comparativo =
          gerarComparativoInteligente(examesPaciente);

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
            <h3>
              Detalhes — {analise.paciente.nome}
            </h3>

            <div
              style={{
                display: "flex",
                gap: 12,
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  background: "#1e293b",
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                Idade: {analise.paciente.idade || "—"}
              </span>
              <span
                style={{
                  background: "#1e293b",
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                Itens alterados:{" "}
                {analise.itensAlterados.length}
              </span>
              <span
                style={{
                  background: "#1e293b",
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                Matches clínicos:{" "}
                {analise.matches.length}
              </span>
            </div>

            <p>
              <b>Interpretação:</b>
            </p>
            <p
              style={{
                whiteSpace: "pre-line",
                lineHeight: "20px",
                opacity: 0.9,
              }}
            >
              {analise.interpretacao}
            </p>

            <p>
              <b>Pontos Críticos:</b>
            </p>
            <ul>
              {analise.pontosCriticos.map(
                (p: string, i: number) => (
                  <li key={i}>{p}</li>
                )
              )}
            </ul>

            <p>
              <b>Terapias Sugeridas:</b>
            </p>
            <ul>
              {analise.terapias.map(
                (t: TerapiaRow) => (
                  <li key={t.id}>
                    <strong>{t.nome}</strong>
                    {" — "}
                    <span style={{ opacity: 0.7 }}>
                      {t.categoria}
                      {t.descricao
                        ? `: ${t.descricao.substring(0, 80)}...`
                        : ""}
                    </span>
                  </li>
                )
              )}
            </ul>

            {analise.setoresAfetados.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <b>Setores afetados:</b>
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    marginTop: 6,
                    flexWrap: "wrap",
                  }}
                >
                  {analise.setoresAfetados.map(
                    (s: string) => (
                      <span
                        key={s}
                        style={{
                          background: "#334155",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 12,
                        }}
                      >
                        {s}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}

            {/* 🔥 EVOLUÇÃO 3: Exibição da Frequência Solfeggio na tela também */}
            {analise.frequencia_lunara && (
              <div style={{ marginBottom: 12 }}>
                <b>Frequência Solfeggio para Sessão:</b>
                <div style={{
                  marginTop: 6,
                  color: "#8b5cf6",
                  background: "#1e293b",
                  padding: "8px 12px",
                  borderRadius: 6,
                  borderLeft: "4px solid #8b5cf6"
                }}>
                  🎵 {analise.frequencia_lunara}
                </div>
              </div>
            )}

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

            <ComparativoExamesView data={comparativo} />
          </div>
        );
      })()}
    </div>
  );
}