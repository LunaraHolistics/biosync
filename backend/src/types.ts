// src/types.ts

// O que o parser retorna (reflete o HTML do dispositivo)
export interface ItemParser {
  item: string;
  valor: number | string;
  sistema?: string;
  status?: string;
  categoria?: string; // ← Esta propriedade resolve o erro TS2339
}

// O que a engine precisa (lógica de negócio)
export interface MarcadorBio {
  nome: string;
  percentual: number; // 0-100
  categoria: string;
  sistema?: string;
  status?: string;
}

// Resultado final da engine
export interface ResultadoBioSync {
  category_scores: Record<string, number>;
  critical_alerts: Array<{ item: string; score: number; impact: string }>;
  quick_wins: Array<{ item: string; action: string; expected: string }>;
  imc: { value: number | null; status: string | null };
  protocol: { therapies: string[]; checklist: string[]; timeline: string };
}