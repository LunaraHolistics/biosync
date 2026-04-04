import type {
  PlanoTerapeutico,
  PlanoTerapeuticoTipo,
  ItemPlanoTerapeutico,
} from "../types/planoTerapeutico";
import type { TerapiaRow } from "./db";
import { listarTerapias } from "./db";

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

export function indicacoesParaTexto(indicacoes: unknown): string {
  if (indicacoes == null) return "";
  if (typeof indicacoes === "string") return indicacoes;
  if (Array.isArray(indicacoes)) {
    return indicacoes.filter((x) => typeof x === "string").join(", ");
  }
  if (typeof indicacoes === "object") {
    return JSON.stringify(indicacoes);
  }
  return String(indicacoes);
}

function tokenizarContexto(pontos: string[], diagnostico: unknown): { texto: string; tokens: Set<string> } {
  const partes: string[] = [...pontos];
  const d = diagnostico as { problemas?: { sistema?: string; item?: string; impacto?: string }[] } | null;
  if (d?.problemas && Array.isArray(d.problemas)) {
    for (const p of d.problemas) {
      if (p.sistema) partes.push(p.sistema);
      if (p.item) partes.push(p.item);
      if (p.impacto) partes.push(p.impacto);
    }
  }
  const texto = partes.join(" ");
  const raw = normalizeText(texto).split(/[^a-z0-9à-ÿ]+/i);
  const tokens = new Set(raw.filter((w) => w.length > 2));
  return { texto: normalizeText(texto), tokens };
}

function pontuacaoTerapia(
  t: TerapiaRow,
  contextoNorm: string,
  tokens: Set<string>,
): number {
  const ind = normalizeText(indicacoesParaTexto(t.indicacoes));
  const desc = normalizeText(typeof t.descricao === "string" ? t.descricao : "");
  const nome = normalizeText(typeof t.nome_terapia === "string" ? t.nome_terapia : "");
  const cat = normalizeText(typeof t.categoria === "string" ? t.categoria : "");
  const hay = `${ind} ${desc} ${nome} ${cat}`;
  let score = 0;
  for (const tok of tokens) {
    if (tok.length < 3) continue;
    if (hay.includes(tok)) score += 3;
  }
  if (contextoNorm.length > 0) {
    const palavrasNome = nome.split(/\s+/).filter((w) => w.length > 3);
    for (const w of palavrasNome) {
      if (contextoNorm.includes(w)) score += 2;
    }
  }
  return score;
}

export function inferirTipoPlano(
  diagnostico: unknown,
  pontos_criticos: string[],
): PlanoTerapeuticoTipo {
  const d = diagnostico as { problemas?: { score?: number }[] } | undefined;
  let severos = 0;
  let moderados = 0;
  if (d?.problemas && Array.isArray(d.problemas)) {
    for (const p of d.problemas) {
      const s = typeof p.score === "number" ? p.score : 0;
      if (s > 50) severos++;
      else if (s > 20) moderados++;
    }
  }
  const nCrit = pontos_criticos.length;
  if (severos >= 1 || nCrit >= 8) return "semanal";
  if (severos + moderados >= 3 || nCrit >= 4) return "quinzenal";
  return "mensal";
}

function frequenciaPadraoItem(tipo: PlanoTerapeuticoTipo, frequencia_base: string | null | undefined): string {
  const fb = typeof frequencia_base === "string" ? frequencia_base.trim() : "";
  if (fb) return fb;
  if (tipo === "semanal") return "1x por semana (referência)";
  if (tipo === "quinzenal") return "1x a cada 15 dias (referência)";
  return "1x por mês (referência)";
}

function montarJustificativa(t: TerapiaRow, pontos: string[]): string {
  const ind = indicacoesParaTexto(t.indicacoes).slice(0, 280);
  const ponto = pontos[0] ?? "perfil clínico-energético avaliado";
  return `Indicações do catálogo: ${ind || "—"}. Vinculação ao contexto atual: ${ponto}.`;
}

export function rankearTerapias(
  catalogo: TerapiaRow[],
  pontos_criticos: string[],
  diagnostico: unknown,
  limite = 8,
): TerapiaRow[] {
  const { texto, tokens } = tokenizarContexto(pontos_criticos, diagnostico);
  const scored = catalogo.map((t) => ({
    t,
    s: pontuacaoTerapia(t, texto, tokens),
  }));
  scored.sort((a, b) => b.s - a.s);
  const comMatch = scored.filter((x) => x.s > 0);
  const escolhidos =
    comMatch.length > 0
      ? comMatch.slice(0, limite).map((x) => x.t)
      : catalogo.slice(0, Math.min(limite, 3));
  return escolhidos;
}

export function montarPlanoTerapeutico(
  tipo: PlanoTerapeuticoTipo,
  terapias: TerapiaRow[],
  pontos_criticos: string[],
): PlanoTerapeutico {
  const itens: ItemPlanoTerapeutico[] = terapias.map((t) => ({
    nome: t.nome_terapia,
    descricao: typeof t.descricao === "string" ? t.descricao : "",
    frequencia: frequenciaPadraoItem(tipo, t.frequencia_base ?? null),
    justificativa: montarJustificativa(t, pontos_criticos),
  }));
  return { tipo, terapias: itens };
}

export async function gerarPlanoTerapeuticoSugerido(
  pontos_criticos: string[],
  diagnostico: unknown,
): Promise<PlanoTerapeutico> {
  const catalogo = await listarTerapias();
  const tipo = inferirTipoPlano(diagnostico, pontos_criticos);
  const rankeadas = rankearTerapias(catalogo, pontos_criticos, diagnostico, 8);
  return montarPlanoTerapeutico(tipo, rankeadas, pontos_criticos);
}