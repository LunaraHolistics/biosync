type Props = {
  exames: any[];
};

function statusToNumero(status: string) {
  if (status === "baixo") return 1;
  if (status === "normal") return 2;
  if (status === "alto") return 3;
  return 0;
}

export default function GraficoEvolucao({ exames }: Props) {
  if (!exames || exames.length === 0) return null;

  const width = 600;
  const height = 250;
  const padding = 40;

  // ordenar por data
  const examesOrdenados = [...exames].sort(
    (a, b) =>
      new Date(a.data_exame).getTime() -
      new Date(b.data_exame).getTime()
  );

  // pegar sistemas do primeiro exame
  const sistemas = Object.keys(
    examesOrdenados[0]?.indice_biosync || {}
  );

  const getX = (index: number) => {
    return (
      padding +
      (index / (examesOrdenados.length - 1 || 1)) *
        (width - padding * 2)
    );
  };

  const getY = (valor: number) => {
    const max = 3;
    const min = 0;

    return (
      height -
      padding -
      ((valor - min) / (max - min)) *
        (height - padding * 2)
    );
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        Evolução Clínica
      </div>

      <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
        {/* eixo Y */}
        {[1, 2, 3].map((v) => (
          <text
            key={v}
            x={5}
            y={getY(v)}
            fontSize="10"
            fill="#94a3b8"
          >
            {v === 1 ? "baixo" : v === 2 ? "normal" : "alto"}
          </text>
        ))}

        {/* linhas */}
        {sistemas.map((sistema, sIndex) => {
          const pontos = examesOrdenados.map((exame, i) => {
            const status =
              exame.indice_biosync?.[sistema]?.status;

            return {
              x: getX(i),
              y: getY(statusToNumero(status)),
            };
          });

          const path = pontos
            .map((p, i) =>
              i === 0
                ? `M ${p.x} ${p.y}`
                : `L ${p.x} ${p.y}`
            )
            .join(" ");

          return (
            <g key={sistema}>
              <path
                d={path}
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2"
              />

              {/* pontos */}
              {pontos.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r="3"
                  fill="#38bdf8"
                />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}