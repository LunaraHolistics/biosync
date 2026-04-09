import React from "react";

type ComparacaoExames = {
  melhoraram: string[];
  pioraram: string[];
  novos_problemas: string[];
  normalizados: string[];
};

type Props = {
  data: ComparacaoExames;
};

function Secao({
  titulo,
  itens,
  cor,
}: {
  titulo: string;
  itens: string[];
  cor: string;
}) {
  if (!itens.length) return null;

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
        {itens.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function ComparativoExamesView({ data }: Props) {
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
      <div style={{ fontWeight: 900, marginBottom: 10 }}>
        EVOLUÇÃO ENTRE EXAMES
      </div>

      <Secao titulo="🟢 Melhoraram" itens={data.melhoraram} cor="#16a34a" />
      <Secao titulo="🔴 Pioraram" itens={data.pioraram} cor="#dc2626" />
      <Secao titulo="🟡 Novos Problemas" itens={data.novos_problemas} cor="#ca8a04" />
      <Secao titulo="⚪ Normalizados" itens={data.normalizados} cor="#6b7280" />
    </div>
  );
}