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

type Evolucao = "melhora" | "piora" | "novo" | "normalizado";
type Status = "baixo" | "normal" | "alto";

type EvolucaoItem = {
  sistema: string;
  item: string;
  antes: Status | null;
  depois: Status | null;
  evolucao: Evolucao;
};

export type ComparacaoExames = {
  melhoraram: EvolucaoItem[];
  pioraram: EvolucaoItem[];
  novos_problemas: EvolucaoItem[];
  normalizados: EvolucaoItem[];
};

type ChartRow = {
  item: string;
  anterior: number | null;
  atual: number | null;
  evolucao: Evolucao;
};

function statusToScore(status: Status | null): number | null {
  if (!status) return null;
  if (status === "baixo") return 1;
  if (status === "normal") return 2;
  return 3;
}

function toChartData(comparacao: ComparacaoExames): ChartRow[] {
  const itens = [
    ...comparacao.melhoraram,
    ...comparacao.pioraram,
    ...comparacao.novos_problemas,
    ...comparacao.normalizados,
  ];

  return itens.map((x) => ({
    item: `${x.sistema} - ${x.item}`,
    anterior: statusToScore(x.antes),
    atual: statusToScore(x.depois),
    evolucao: x.evolucao,
  }));
}

function dotColor(evolucao: Evolucao): string {
  if (evolucao === "melhora") return "#16a34a";
  if (evolucao === "piora") return "#dc2626";
  if (evolucao === "novo") return "#f59e0b";
  return "#6b7280";
}

type Props = {
  comparacao: ComparacaoExames | null;
};

export function ComparativoExames({ comparacao }: Props) {
  if (!comparacao) return null;

  const data = toChartData(comparacao);
  if (!data.length) return null;

  return (
    <section
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 10 }}>Comparativo de exames</div>
      <div style={{ display: "flex", gap: 14, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ color: "#16a34a", fontWeight: 700 }}>
          {comparacao.melhoraram.length} itens melhoraram
        </div>
        <div style={{ color: "#dc2626", fontWeight: 700 }}>
          {comparacao.pioraram.length} itens pioraram
        </div>
      </div>

      <div style={{ width: "100%", height: 320 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 50 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="item"
              angle={-25}
              textAnchor="end"
              interval={0}
              height={80}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              tickFormatter={(value) => {
                if (value === 1) return "baixo";
                if (value === 2) return "normal";
                if (value === 3) return "alto";
                return "";
              }}
              domain={[1, 3]}
              ticks={[1, 2, 3]}
            />
            <Tooltip
              formatter={(value, name) => {
                const map: Record<number, string> = { 1: "baixo", 2: "normal", 3: "alto" };
                return [map[Number(value)] ?? String(value ?? ""), String(name ?? "")];
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="anterior"
              name="Exame anterior"
              stroke="#6b7280"
              strokeWidth={2}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="atual"
              name="Exame atual"
              stroke="#2563eb"
              strokeWidth={2}
              connectNulls
              dot={(props) => {
                const { cx, cy, payload } = props as {
                  cx?: number;
                  cy?: number;
                  payload?: ChartRow;
                };
                if (cx == null || cy == null || !payload) return null;
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={4}
                    stroke="#111827"
                    strokeWidth={1}
                    fill={dotColor(payload.evolucao)}
                  />
                );
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
