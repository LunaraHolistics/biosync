import { Router } from "express";
import multer from "multer";
import { parseHtmReport, ParsedHtmData } from "../utils/parserHtml";

const router = Router();
const upload = multer();

/**
 * Converte o objeto estruturado do parser em texto corrido (para fallback/compatibilidade)
 */
function gerarTextoLegivel(dados: ParsedHtmData): string {
  let texto = `Relatório: ${dados.nome} - ${dados.sexo} - ${dados.idade} anos\n`;
  texto += `Data do Teste: ${dados.data_teste}\n`;
  texto += `Protocolo: ${dados.protocolo}\n\n`;

  for (const analise of dados.analises) {
    texto += `=== ${analise.categoria} ===\n`;
    for (const r of analise.resultados) {
      texto += `- ${r.item}: ${r.valor} (Normal: ${r.intervalo}) -> ${r.resultado}\n`;
    }
    texto += `\n`;
  }

  return texto;
}

router.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const textos: string[] = [];
    const dadosEstruturados: ParsedHtmData[] = [];

    for (const file of files) {
      try {
        const mimetype = file.mimetype;
        const ext = file.originalname.toLowerCase().split('.').pop();

        // 🔥 HTML / HTM (Corrigido para aceitar extensão .htm corretamente)
        if (mimetype.includes("html") || ext === 'htm' || ext === 'html') {
          
          // ✅ Parser estruturado (passa o BUFFER para decodificar iso-8859-1 corretamente)
          const dados = parseHtmReport(file.buffer);
          
          dadosEstruturados.push(dados);
          console.log(`✅ Dados estruturados extraídos de ${file.originalname} (${dados.analises.length} categorias)`);

          // Gera texto corrido a partir dos dados estruturados para manter compatibilidade
          const textoLegivel = gerarTextoLegivel(dados);
          textos.push(textoLegivel);
        }

        // 🔥 TXT
        else if (mimetype.includes("text") || ext === 'txt') {
          const texto = file.buffer.toString("utf-8");
          textos.push(texto);
          console.log("TXT processado");
        }

        // ⚠️ PDF (fallback simples)
        else if (mimetype.includes("pdf") || ext === 'pdf') {
          console.log("PDF detectado (processamento depende de outro parser se houver)");
        }

        else {
          console.log("Tipo não suportado:", mimetype, "Extensão:", ext);
          continue;
        }

      } catch (err) {
        console.error(`Erro ao processar arquivo ${file.originalname}:`, err);
      }
    }

    if (textos.length === 0 && dadosEstruturados.length === 0) {
      return res.status(400).json({
        error: "Nenhum conteúdo útil encontrado nos arquivos",
      });
    }

    return res.json({
      sucesso: true,
      textos,
      dadosEstruturados, // 🚀 Envia os dados perfeitamente estruturados para o frontend
    });

  } catch (error: any) {
    console.error("Erro upload:", error);

    return res.status(500).json({
      error: "Erro ao processar upload",
      details: error?.message,
    });
  }
});

export default router;
