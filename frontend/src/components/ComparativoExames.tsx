import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Status = "baixo" | "normal" | "alto";

type Evolucao =
  | "melhora"
  | "piora"
  | "novo"
  | "normalizado";

type EvolucaoItem = {
  sistema: string;
  item: string;
  antes: Status | null;
  depois: Status | null;
  valor_antes?: number;
  valor_depois?: number;
  variacao?: number;
  evolucao: Evolucao;
};

type ComparacaoExames = {
  melhoraram: EvolucaoItem[];
  pioraram: EvolucaoItem[];
  novos_problemas: EvolucaoItem[];
  normalizados: EvolucaoItem[];
};

type Props = {
  data: ComparacaoExames;
};

// ==============================
// 🔥 CONVERSÃO PARA GRÁFICO
// ==============================

function statusToScore(status: Status | null): number | null {
  if (!status) return null;
  if (status === "baixo") return 1;
  if (status === "normal") return 2;
  return 3;
}

function ordemEvolucao(e: Evolucao): number {
  if (e === "piora") return 1;
  if (e === "novo") return 2;
  if (e === "melhora") return 3;
  return 4;
}

function toChartData(comparacao: ComparacaoExames) {
  const mapa = new Map<string, EvolucaoItem>();

  const todos = [
    ...comparacao.melhoraram,
    ...comparacao.pioraram,
    ...comparacao.novos_problemas,
    ...comparacao.normalizados,
  ];

  for (const item of todos) {
    const key = `${item.sistema}::${item.item}`;
    if (!mapa.has(key)) {
      mapa.set(key, item);
    }
  }

  return Array.from(mapa.values())
    .map((x) => ({
      item: `${x.sistema} - ${x.item}`,
      anterior: statusToScore(x.antes),
      atual: statusToScore(x.depois),
      evolucao: x.evolucao,
    }))
    .sort((a, b) => {
      const ordem =
        ordemEvolucao(a.evolucao) -
        ordemEvolucao(b.evolucao);
      if (ordem !== 0) return ordem;
      return a.item.localeCompare(b.item);
    });
}

function dotColor(evolucao: Evolucao): string {
  if (evolucao === "melhora") return "#16a34a";
  if (evolucao === "piora") return "#dc2626";
  if (evolucao === "novo") return "#f59e0b";
  return "#6b7280";
}

// ==============================
// 🔥 UI ATUAL (MANTIDA)
// ==============================

function Badge({ tipo }: { tipo: Evolucao }) {
  const mapa = {
    melhora: { label: "↑ Melhorou", cor: "#16a34a" },
    piora: { label: "↓ Piorou", cor: "#dc2626" },
    novo: { label: "Novo", cor: "#ca8a04" },
    normalizado: { label: "Normalizou", cor: "#6b7280" },
  };

  const cfg = mapa[tipo];

  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 6px",
        borderRadius: 6,
        background: cfg.cor,
        color: "white",
        marginLeft: 6,
      }}
    >
      {cfg.label}
    </span>
  );
}

function ItemLinha({ item }: { item: EvolucaoItem }) {
  return (
    <li style={{ marginBottom: 8 }}>
      <strong>{item.sistema}</strong> — {item.item}
      <Badge tipo={item.evolucao} />

      <div style={{ fontSize: 12, opacity: 0.8 }}>
        {item.antes ?? "—"} → {item.depois ?? "—"}

        {item.variacao !== undefined && (
          <span> | Δ {item.variacao}</span>
        )}
      </div>
    </li>
  );
}

function ordenarItens(itens: EvolucaoItem[]) {
  return [...itens].sort((a, b) => {
    const va = Math.abs(a.variacao ?? 0);
    const vb = Math.abs(b.variacao ?? 0);
    return vb - va;
  });
}

function Secao({
  titulo,
  itens,
  cor,
}: {
  titulo: string;
  itens: EvolucaoItem[];
  cor: string;
}) {
  if (!itens.length) return null;

  const itensOrdenados = ordenarItens(itens);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 800, marginBottom: 6, color: cor }}>
        {titulo} ({itens.length})
      </div>

      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {itensOrdenados.map((item, i) => (
          <ItemLinha key={i} item={item} />
        ))}
      </ul>
    </div>
  );
}

// ==============================
// 🚀 COMPONENTE FINAL
// ==============================

export default function ComparativoExamesView({
  data,
}: Props) {
  if (!data) return null;

  const totalMudancas =
    data.melhoraram.length +
    data.pioraram.length +
    data.novos_problemas.length +
    data.normalizados.length;

  if (totalMudancas === 0) {
    return (
      <div style={{ opacity: 0.7 }}>
        Nenhuma variação relevante entre os exames.
      </div>
    );
  }

  const chartData = toChartData(data);

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 900, marginBottom: 10 }}>
        EVOLUÇÃO ENTRE EXAMES
      </div>

      {/* 🔥 LISTA (SEU MODELO) */}
      <Secao titulo="🟢 Melhoraram" itens={data.melhoraram} cor="#16a34a" />
      <Secao titulo="🔴 Pioraram" itens={data.pioraram} cor="#dc2626" />
      <Secao titulo="🟡 Novos Problemas" itens={data.novos_problemas} cor="#ca8a04" />
      <Secao titulo="⚪ Normalizados" itens={data.normalizados} cor="#6b7280" />

      {/* 🔥 GRÁFICO (NOVO) */}
      {chartData.length > 0 && (
        <div style={{ width: "100%", height: 320, marginTop: 20 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />

              <XAxis
                dataKey="item"
                angle={-25}
                textAnchor="end"
                interval={0}
                height={80}
              />

              <YAxis
                domain={[1, 3]}
                ticks={[1, 2, 3]}
                tickFormatter={(v) =>
                  v === 1 ? "baixo" : v === 2 ? "normal" : "alto"
                }
              />

              <Tooltip />

              <Legend />

              <Line
                type="monotone"
                dataKey="anterior"
                stroke="#6b7280"
                name="Antes"
              />

              <Line
                type="monotone"
                dataKey="atual"
                stroke="#2563eb"
                name="Depois"
                dot={(props: any) => {
                  const { cx, cy, payload } = props;
                  if (!cx || !cy || !payload) return null;

                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={dotColor(payload.evolucao)}
                    />
                  );
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}