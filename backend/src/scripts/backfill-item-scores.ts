// backend/src/scripts/backfill-item-scores.ts

// ✅ IMPORTS CORRETOS baseados na estrutura real do backend
import { supabase } from '../config/supabase';
import { gerarAnaliseCompleta } from '.frontend/src/lib/motorSemantico';
// ✅ Importar funções específicas dos arquivos dentro de db/
import { listarBaseAnaliseSaude } from './db/analises.repository';
import { listarTerapias } from "./services/db";

async function backfillItemScores(pacienteNome: string) {
  console.log(`🔄 Iniciando backfill para: ${pacienteNome}`);
  
  // ✅ CORREÇÃO: Supabase retorna { data, error }, não { exames, error }
  const {  data: exames, error } = await supabase
    .from('exames')
    .select('id, nome_paciente, resultado_json, indice_biosync')
    .ilike('nome_paciente', `%${pacienteNome}%`)
    .order('data_exame', { ascending: false });

  if (error) {
    console.error('❌ Erro ao buscar exames:', error);
    return;
  }

  if (!exames || exames.length === 0) {
    console.log(`⚠️ Nenhum exame encontrado para: ${pacienteNome}`);
    return;
  }

  // Carrega bases de dados
  const [base, terapias] = await Promise.all([
    listarBaseAnaliseSaude(),
    listarTerapias()
  ]);

  let atualizados = 0;

  for (const exame of exames) {
    // Pula se já tem item_scores
    if (exame.indice_biosync?.item_scores?.length) {
      console.log(`⏭️ Já possui item_scores: ${exame.id}`);
      continue;
    }

    try {
      // Re-processa a análise com os dados do exame
      const analise = gerarAnaliseCompleta(
        { ...exame, resultado_json: exame.resultado_json || {} } as any,
        base,
        terapias
      );

      // Mapeia matches para estrutura de item_scores
      const itemScores = analise.matches?.map((m: any) => ({
        item: m.itemBase,
        categoria: m.categoria,
        score: m.score ?? 50,
        status: m.gravidade,
        impacto: m.impacto,
        impacto_fitness: m.impacto_fitness
      })) || [];

      // Atualiza o exame no Supabase
      const { error: updateError } = await supabase
        .from('exames')
        .update({
          indice_biosync: {
            ...(exame.indice_biosync || {}),
            item_scores: itemScores,
            processed_at: new Date().toISOString()
          }
        })
        .eq('id', exame.id);

      if (updateError) throw updateError;

      console.log(`✅ Atualizado: ${exame.id} (${itemScores.length} itens)`);
      atualizados++;

      // Delay para não sobrecarregar a API
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (err: any) {
      console.error(`❌ Erro ao processar ${exame.id}:`, err.message);
    }
  }

  console.log(`\n🎉 Backfill concluído: ${atualizados}/${exames.length} exames atualizados`);
}

// Executa se chamado diretamente via CLI
if (require.main === module) {
  const paciente = process.argv[2] || 'Lucimara';
  backfillItemScores(paciente).catch(console.error);
}

export { backfillItemScores };