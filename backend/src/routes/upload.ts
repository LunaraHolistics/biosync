import { Router } from "express";
import multer from "multer";
import { parseHtmReport, ParsedHtmData } from "../utils/parserHtml";

const router = Router();
const upload = multer();

/**
 * Converte o objeto estruturado do parser em texto corrido (fallback)
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

    // 🔥 NOVO: guardar HTML original
    const htmlsOriginais: string[] = [];

    for (const file of files) {
      try {
        const mimetype = file.mimetype;
        const ext = file.originalname.toLowerCase().split(".").pop();

        // 🔥 HTML / HTM
        if (mimetype.includes("html") || ext === "htm" || ext === "html") {
          // ✅ preserva HTML ORIGINAL (ESSENCIAL)
          const htmlOriginal = file.buffer.toString("latin1"); // iso-8859-1 safe
          htmlsOriginais.push(htmlOriginal);

          // ✅ parser estruturado
          const dados = parseHtmReport(file.buffer);

          dadosEstruturados.push(dados);
          console.log(
            `✅ Dados estruturados extraídos de ${file.originalname} (${dados.analises.length} categorias)`
          );

          // fallback texto
          const textoLegivel = gerarTextoLegivel(dados);
          textos.push(textoLegivel);
        }

        // 🔥 TXT
        else if (mimetype.includes("text") || ext === "txt") {
          const texto = file.buffer.toString("utf-8");
          textos.push(texto);
          console.log("TXT processado");
        }

        // ⚠️ PDF
        else if (mimetype.includes("pdf") || ext === "pdf") {
          console.log(
            "PDF detectado (processamento depende de outro parser se houver)"
          );
        }

        else {
          console.log("Tipo não suportado:", mimetype, "Extensão:", ext);
          continue;
        }
      } catch (err) {
        console.error(
          `Erro ao processar arquivo ${file.originalname}:`,
          err
        );
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
      dadosEstruturados,

      // 🔥 NOVO CAMPO CRÍTICO
      relatorio_original_html: htmlsOriginais.join("\n\n"),
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