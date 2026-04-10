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

// 🔥 Badge visual de evolução
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

// 🔥 Item evoluído
function ItemLinha({ item }: { item: EvolucaoItem }) {
  return (
    <li style={{ marginBottom: 8 }}>
      <strong>{item.sistema}</strong> — {item.item}
      <Badge tipo={item.evolucao} />

      <div
        style={{
          fontSize: 12,
          opacity: 0.8,
          marginTop: 2,
        }}
      >
        {item.antes ?? "—"} → {item.depois ?? "—"}

        {item.variacao !== undefined && (
          <span style={{ marginLeft: 6 }}>
            | Δ {item.variacao}
          </span>
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
      <div
        style={{
          fontWeight: 800,
          marginBottom: 6,
          color: cor,
        }}
      >
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

  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{
          fontWeight: 900,
          marginBottom: 10,
        }}
      >
        EVOLUÇÃO ENTRE EXAMES
      </div>

      <Secao
        titulo="🟢 Melhoraram"
        itens={data.melhoraram}
        cor="#16a34a"
      />

      <Secao
        titulo="🔴 Pioraram"
        itens={data.pioraram}
        cor="#dc2626"
      />

      <Secao
        titulo="🟡 Novos Problemas"
        itens={data.novos_problemas}
        cor="#ca8a04"
      />

      <Secao
        titulo="⚪ Normalizados"
        itens={data.normalizados}
        cor="#6b7280"
      />
    </div>
  );
}