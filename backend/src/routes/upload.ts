import { Router } from "express";
import multer from "multer";

const router = Router();
const upload = multer();

/**
 * Remove tags HTML e limpa texto
 */
function limparHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

router.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const textos: string[] = [];

    for (const file of files) {
      try {
        const mimetype = file.mimetype;
        let texto = "";

        // 🔥 HTML
        if (mimetype.includes("html")) {
          const raw = file.buffer.toString("utf-8");
          texto = limparHtml(raw);

          console.log("HTML processado");
        }

        // 🔥 TXT
        else if (mimetype.includes("text")) {
          texto = file.buffer.toString("utf-8");

          console.log("TXT processado");
        }

        // ⚠️ PDF (tentativa simples — pode falhar)
        else if (mimetype.includes("pdf")) {
          const raw = file.buffer.toString("utf-8");

          console.log("PDF detectado (provavelmente imagem)");

          // fallback: tentar extrair algo bruto
          texto = raw;

          // 👉 opcional: ignorar PDF vazio depois
        }

        else {
          console.log("Tipo não suportado:", mimetype);
          continue;
        }

        // 🔍 DEBUG
        console.log("PREVIEW:");
        console.log(texto.slice(0, 300));

        if (texto && texto.length > 50) {
          textos.push(texto);
        } else {
          console.log("Arquivo ignorado (sem conteúdo útil)");
        }

      } catch (err) {
        console.error("Erro ao processar arquivo:", err);
      }
    }

    if (textos.length === 0) {
      return res.status(400).json({
        error: "Nenhum conteúdo útil encontrado nos arquivos",
      });
    }

    return res.json({ textos });

  } catch (error: any) {
    console.error("Erro upload:", error);

    return res.status(500).json({
      error: "Erro ao processar upload",
      details: error?.message,
    });
  }
});

export default router;