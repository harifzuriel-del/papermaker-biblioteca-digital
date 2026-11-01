```javascript
import {
  json,
  currentUser,
  sameOrigin
} from "./_lib.js";

export async function onRequestPost({ request, env }) {

  // Validar origen
  if (!sameOrigin(request)) {
    return json({ error: "Origen no permitido." }, 403);
  }

  // Validar sesión
  const user = await currentUser(request, env);

  if (!user) {
    return json({
      error: "Inicia sesión para realizar la prueba."
    }, 401);
  }

  // Comprobar binding
  if (!env.AI) {
    return json({
      error: "El binding AI no está disponible."
    }, 500);
  }

  // Texto de prueba
  const originalText =
    "The journey of life is not about finding yourself, but about creating yourself. Every experience teaches us something new.";

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
```
