
import {
  json,
  currentUser,
  sameOrigin
} from "./_lib.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) {
    return json({ error: "Origen no permitido." }, 403);
  }

  const user = await currentUser(request, env);

  if (!user) {
    return json({ error: "Inicia sesión para realizar la prueba." }, 401);
  }

  if (!env.AI) {
    return json({ error: "El binding AI no está disponible." }, 500);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "El cuerpo de la solicitud no es válido." }, 400);
  }

  const originalText = String(body?.text || "").trim();

  if (!originalText) {
    return json({ error: "Debes enviar un texto para traducir." }, 400);
  }

  if (originalText.length > 4000) {
    return json({
      error: "El texto supera el límite de prueba de 4,000 caracteres.",
      caracteres: originalText.length
    }, 400);
  }

  try {
    const result = await env.AI.run(
      "@cf/meta/m2m100-1.2b",
      {
        text: originalText,
        source_lang: "en",
        target_lang: "es"
      }
    );

    if (
      !result ||
      typeof result.translated_text !== "string" ||
      !result.translated_text.trim()
    ) {
      return json({
        error: "Cloudflare AI no devolvió una traducción válida.",
        result
      }, 502);
    }

    return json({
      ok: true,
      motor: "PaperMaker Translate",
      modelo: "@cf/meta/m2m100-1.2b",
      caracteres_originales: originalText.length,
      caracteres_traducidos: result.translated_text.length,
      original: originalText,
      traduccion: result.translated_text
    });

  } catch (error) {
    console.error("Error Workers AI:", error);

    return json({
      error: "No se pudo ejecutar el modelo de traducción.",
      detalle: error?.message || "Error desconocido."
    }, 502);
  }
}

