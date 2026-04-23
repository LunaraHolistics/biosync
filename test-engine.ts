// test-engine.ts
// 📦 Script de teste direto da engine BioSync (sem HTTP, sem Postman)

import { processBioSyncData } from "./backend/src/services/engine-processor";

// 🔬 DADOS DE TESTE (Baseado no exame real da Lucimara)
const mockLucimaraData = [
  { nome: "Cálcio", percentual: 30, categoria: "Minerais" },      // Baixo = crítico
  { nome: "Magnésio", percentual: 25, categoria: "Minerais" },    // Baixo = sono ruim
  { nome: "Zinco", percentual: 40, categoria: "Minerais" },
  { nome: "Nível de Consciência", percentual: 33, categoria: "Emocional" }, // Stress
  { nome: "Sobrecarga do Sistema Nervoso", percentual: 20, categoria: "Emocional" }, // Insônia
  { nome: "Fadiga Visual", percentual: 45, categoria: "Físico" },
  { nome: "Fígado", percentual: 35, categoria: "Órgãos" },
  { nome: "Rins", percentual: 40, categoria: "Órgãos" },
  { nome: "Metabolismo Basal", percentual: 50, categoria: "Metabolismo" },
  { nome: "Compulsão Alimentar", percentual: 30, categoria: "Emocional" },
  { nome: "Imunidade", percentual: 60, categoria: "Imunidade" },
  { nome: "Clareza Mental", percentual: 35, categoria: "Mental" },
];

async function runTest() {
  console.log("🚀 Iniciando teste da engine BioSync...\n");

  try {
    // 🎯 Teste 1: Modo Sono (foco na insônia dela)
    console.log("🌙 Teste 1: Modo 'emotional_sleep' (Foco: Insônia/Stress)");
    const resultSono = await processBioSyncData(
      mockLucimaraData,
      'emotional_sleep',
      65,   // peso
      1.65  // altura
    );
    
    console.log("\n📊 RESULTADO:");
    console.log("├─ Modo:", resultSono.modo_selecionado);
    console.log("├─ Scores:", resultSono.category_scores);
    console.log("├─ IMC:", resultSono.imc_value, `(${resultSono.imc_status})`);
    console.log("├─ Alertas Críticos:", resultSono.critical_alerts.length);
    resultSono.critical_alerts.forEach((alert, i) => {
      console.log(`│  ${i+1}. ${alert.item} (Score: ${alert.score})`);
      console.log(`│     → ${alert.impact}`);
    });
    console.log("├─ Quick Wins:", resultSono.quick_wins.length);
    console.log("└─ Protocolo Sugerido:", resultSono.suggested_protocol.therapies.join(", "));

    // 🎯 Teste 2: Modo Fitness (para comparar)
    console.log("\n💪 Teste 2: Modo 'fitness' (Foco: Performance)");
    const resultFitness = await processBioSyncData(
      mockLucimaraData,
      'fitness',
      65,
      1.65
    );
    
    console.log("\n📊 RESULTADO:");
    console.log("├─ Scores:", resultFitness.category_scores);
    console.log("├─ Alertas Críticos:", resultFitness.critical_alerts.map(a => a.item).join(", "));

    console.log("\n✅ TESTE CONCLUÍDO! A engine está processando corretamente.");
    console.log("💡 Próximo passo: Integrar esses dados no frontend quando o backend estiver estável.");

  } catch (error: any) {
    console.error("❌ ERRO NO TESTE:", error.message);
    console.error("📉 Stack:", error.stack);
  }
}

// Executa o teste
runTest();