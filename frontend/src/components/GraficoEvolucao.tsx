type Ponto = {
  data: string;
  score: number;
};

type Props = {
  dados: Ponto[];
};

export default function GraficoEvolucao({ dados }: Props) {
  if (!dados || dados.length < 2) return null;

  const width = 600;
  const height = 250;
  const padding = 40;

  const maxScore = 100;
  const minScore = 0;

  const getX = (index: number) => {
    return (
      padding +
      (index / (dados.length - 1)) *
        (width - padding * 2)
    );
  };

  const getY = (valor: number) => {
    return (
      height -
      padding -
      ((valor - minScore) / (maxScore - minScore)) *
        (height - padding * 2)
    );
  };

  const pontos = dados.map((d, i) => ({
    x: getX(i),
    y: getY(d.score),
    label: d.data,
    score: d.score,
  }));

  const path = pontos
    .map((p, i) =>
      i === 0
        ? `M ${p.x} ${p.y}`
        : `L ${p.x} ${p.y}`
    )
    .join(" ");

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        Evolução do Índice BioSync
      </div>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
        {/* 🔹 eixo Y */}
        {[0, 25, 50, 75, 100].map((v) => (
          <text
            key={v}
            x={5}
            y={getY(v)}
            fontSize="10"
            fill="#94a3b8"
          >
            {v}
          </text>
        ))}

        {/* 🔹 linha */}
        <path
          d={path}
          fill="none"
          stroke="#22c55e"
          strokeWidth="2"
        />

        {/* 🔹 pontos */}
        {pontos.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r="4"
              fill="#22c55e"
            />

            {/* tooltip simples */}
            <title>
              {p.label} — Score: {p.score}
            </title>
          </g>
        ))}
      </svg>
    </div>
  );
}