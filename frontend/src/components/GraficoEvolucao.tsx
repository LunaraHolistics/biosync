import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
} from "recharts";

import type { ExameRow } from "../services/db";

type Props = {
  exames: ExameRow[];
};

type Ponto = {
  data: string;
  score: number;
};

// 🔥 função segura de score
function calcularScore(exame: ExameRow): number {
  const pontos =
    (exame.analise_ia as any)?.pontos_criticos ??
    exame.pontos_criticos ??
    [];

  const qtd = pontos.length;

  if (qtd === 0) return 90;
  if (qtd <= 2) return 75;
  if (qtd <= 4) return 55;
  return 30;
}

export default function GraficoEvolucao({ exames }: Props) {
  if (!exames || exames.length === 0) return null;

  const dados: Ponto[] = exames.map((exame) => ({
    data: new Date(exame.data_exame).toLocaleDateString(),
    score: calcularScore(exame),
  }));

  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={dados}>
          <CartesianGrid strokeDasharray="3 3" />

          <XAxis dataKey="data" />

          <YAxis />

          <Tooltip />

          <Legend />

          <Line
            type="monotone"
            dataKey="score"
            stroke="#22c55e"
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}