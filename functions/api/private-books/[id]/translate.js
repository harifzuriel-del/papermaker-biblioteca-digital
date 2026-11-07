
import {
  json,
  currentUser,
  bodyJsonLimited,
  sameOrigin
} from "../../_lib.js";

// ==========================================
// CONFIGURACIÓN
// ==========================================

const MAX_CHAPTER_LENGTH = 120000;

// Fragmentos pequeños para reducir omisiones
// del modelo de traducción.
const MAX_CHUNK_LENGTH = 350;

const AI_MODEL = "@cf/meta/m2m100-1.2b";
const TARGET_LANGUAGE = "es";


// ==========================================
// DIVIDIR TEXTO EN FRAGMENTOS
// ==========================================

function splitIntoChunks(text, maxLength = MAX_CHUNK_LENGTH) {
  const sentences =
    text.match(/[^.!?]+[.!?]+(?:["'”’)\]]+)?|[^.!?]+$/g) || [text];

  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const part = sentence.trim();

    if (!part) continue;

    if (part.length <= maxLength) {
      if (
        current &&
        current.length + part.length + 1 > maxLength
      ) {
        chunks.push(current);
        current = "";
      }

      current += (current ? " " : "") + part;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    const words = part.split(/\s+/);
    let wordChunk = "";

    for (const word of words) {
      if (
        wordChunk &&
        wordChunk.length + word.length + 1 > maxLength
      ) {
        chunks.push(wordChunk);
        wordChunk = "";
      }

      wordChunk += (wordChunk ? " " : "") + word;
    }

    if (wordChunk) {
      chunks.push(wordChunk);
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}


// ==========================================
// TRADUCIR CON WORKERS AI
// ==========================================

async function translateWithWorkersAI(text, env) {
  if (!env.AI) {
    throw new Error("El binding Workers AI no está disponible.");
  }

  const result = await env.AI.run(AI_MODEL, {
    text,
    source_lang: "en",
    target_lang: "es"
  });

  if (
    !result ||
    typeof result.translated_text !== "string" ||
    !result.translated_text.trim()
  ) {
    throw new Error("Workers AI devolvió una traducción vacía.");
  }

  return result.translated_text.trim();
}


// ==========================================
// TRADUCIR CON LIBRETRANSLATE
// ==========================================

async function translateWithLibreTranslate(text, env) {
  const translatorUrl = env.LIBRETRANSLATE_URL;

  if (!translatorUrl) {
    throw new Error("LibreTranslate no está configurado.");
  }

  const response = await fetch(
    translatorUrl.replace(/\/+$/, "") + "/translate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        q: text,
        source: "en",
        target: "es",
        format: "text"
      }),
      signal: AbortSignal.timeout(45000)
    }
  );

  if (!response.ok) {
    throw new Error(
      `LibreTranslate respondió con HTTP ${response.status}.`
    );
  }

  const result = await response.json();

  if (
    !result ||
    typeof result.translatedText !== "string" ||
    !result.translatedText.trim()
  ) {
    throw new Error("LibreTranslate devolvió una traducción vacía.");
  }

  return result.translatedText.trim();
}


// ==========================================
// MOTOR HÍBRIDO
// WORKERS AI PRIMERO
// LIBRETRANSLATE COMO RESPALDO
// ==========================================

async function translateChunk(text, env) {
  try {
    const translated = await translateWithWorkersAI(text, env);

    return {
      text: translated,
      motor: "workers-ai"
    };

  } catch (aiError) {
    console.error(
      "Workers AI no pudo traducir el fragmento. Se intentará LibreTranslate:",
      aiError
    );

    try {
      const translated = await translateWithLibreTranslate(text, env);

      return {
        text: translated,
        motor: "libretranslate"
      };

    } catch (fallbackError) {
      console.error(
        "También falló LibreTranslate:",
        fallbackError
      );

      throw new Error(
        "No fue posible traducir un fragmento con ninguno de los motores."
      );
    }
  }
}


// ==========================================
// TRADUCIR UN PÁRRAFO
// ==========================================

async function translateParagraph(paragraph, env, stats) {
  const chunks = splitIntoChunks(paragraph);
  const translatedParts = [];

  for (const chunk of chunks) {
    const result = await translateChunk(chunk, env);

    translatedParts.push(result.text);

    if (result.motor === "workers-ai") {
      stats.workersAI++;
    } else {
      stats.libreTranslate++;
    }
  }

  return translatedParts.join(" ");
}


// ==========================================
// ENDPOINT PRINCIPAL
// ==========================================

export async function onRequestPost({ request, env, params }) {

  // ------------------------------------------
  // 1. VALIDAR ORIGEN
  // ------------------------------------------

  if (!sameOrigin(request)) {
    return json({
      error: "Origen no permitido."
    }, 403);
  }


  // ------------------------------------------
  // 2. VALIDAR SESIÓN
  // ------------------------------------------

  const user = await currentUser(request, env);

  if (!user) {
    return json({
      error: "Inicia sesión para traducir tus libros."
    }, 401);
  }


  // ------------------------------------------
  // 3. LEER SOLICITUD
  // ------------------------------------------

  const parsed = await bodyJsonLimited(request, 10000);

  if (!parsed.ok) {
    return json({
      error: parsed.error
    }, parsed.status);
  }

  const body = parsed.data;

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !Number.isInteger(body.chapter)
  ) {
    return json({
      error: "El capítulo solicitado no es válido."
    }, 400);
  }


  // ------------------------------------------
  // 4. BUSCAR LIBRO DEL USUARIO
  // ------------------------------------------

  const book = await env.DB.prepare(
    `SELECT id, language, content_json
     FROM private_books
     WHERE id = ? AND user_id = ?`
  ).bind(params.id, user.id).first();

  if (!book) {
    return json({
      error: "Libro privado no encontrado."
    }, 404);
  }


  // ------------------------------------------
  // 5. COMPROBAR IDIOMA
  // ------------------------------------------

  if (book.language !== "en") {
    return json({
      error: "Por ahora la traducción está configurada para libros en inglés."
    }, 400);
  }


  // ------------------------------------------
  // 6. OBTENER CAPÍTULO
  // ------------------------------------------

  let content;

  try {
    content = JSON.parse(book.content_json);
  } catch {
    return json({
      error: "No se pudo leer el contenido del libro."
    }, 500);
  }

  if (
    !content ||
    !Array.isArray(content.chapters) ||
    body.chapter < 0 ||
    body.chapter >= content.chapters.length
  ) {
    return json({
      error: "El capítulo solicitado no existe."
    }, 404);
  }

  const chapter = content.chapters[body.chapter];

  if (
    !chapter ||
    !Array.isArray(chapter.paragraphs) ||
    chapter.paragraphs.length === 0
  ) {
    return json({
      error: "El capítulo no contiene texto para traducir."
    }, 400);
  }


  // ------------------------------------------
  // 7. VALIDAR TAMAÑO
  // ------------------------------------------

  const paragraphs = chapter.paragraphs;
  const originalText = paragraphs.join("\n\n");

  if (!originalText.trim()) {
    return json({
      error: "El capítulo no contiene texto para traducir."
    }, 400);
  }

  if (originalText.length > MAX_CHAPTER_LENGTH) {
    return json({
      error: "El capítulo supera el límite de 120,000 caracteres."
    }, 413);
  }


  // ------------------------------------------
  // 8. COMPROBAR TRADUCCIÓN GUARDADA
  // ------------------------------------------

  try {
    const saved = await env.DB.prepare(
      `SELECT paragraphs_json
       FROM private_book_translations
       WHERE book_id = ?
         AND user_id = ?
         AND chapter_index = ?
         AND language = ?`
    ).bind(
      book.id,
      user.id,
      body.chapter,
      TARGET_LANGUAGE
    ).first();

    if (saved) {
      const savedParagraphs = JSON.parse(
        saved.paragraphs_json
      );

      if (
        Array.isArray(savedParagraphs) &&
        savedParagraphs.length === paragraphs.length
      ) {
        return json({
          ok: true,
          chapter: body.chapter,
          title: chapter.title,
          paragraphs: savedParagraphs,
          language: TARGET_LANGUAGE,
          cached: true,
          motor: "database"
        });
      }
    }

  } catch (error) {
    console.error(
      "Error consultando traducción guardada:",
      error
    );

    return json({
      error: "No se pudo consultar el historial de traducciones."
    }, 500);
  }


  // ------------------------------------------
  // 9. TRADUCIR PÁRRAFOS
  // ------------------------------------------

  const translatedParagraphs = [];

  const stats = {
    workersAI: 0,
    libreTranslate: 0
  };

  try {
    for (const paragraph of paragraphs) {
      if (
        typeof paragraph !== "string" ||
        !paragraph.trim()
      ) {
        translatedParagraphs.push("");
        continue;
      }

      const translated = await translateParagraph(
        paragraph,
        env,
        stats
      );

      translatedParagraphs.push(translated);
    }

  } catch (error) {
    console.error(
      "Error durante la traducción:",
      error
    );

    return json({
      error: error?.message ||
        "No se pudo completar la traducción.",
      guardado: false
    }, 502);
  }


  // ------------------------------------------
  // 10. GUARDAR TRADUCCIÓN EN D1
  // ------------------------------------------

  try {
    await env.DB.prepare(
      `INSERT INTO private_book_translations
       (
         book_id,
         user_id,
         chapter_index,
         language,
         paragraphs_json,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

       ON CONFLICT (
         book_id,
         user_id,
         chapter_index,
         language
       )
       DO UPDATE SET
         paragraphs_json = excluded.paragraphs_json,
         updated_at = CURRENT_TIMESTAMP`
    ).bind(
      book.id,
      user.id,
      body.chapter,
      TARGET_LANGUAGE,
      JSON.stringify(translatedParagraphs)
    ).run();

  } catch (error) {
    console.error(
      "Error guardando traducción en D1:",
      error
    );

    return json({
      error: "La traducción se realizó, pero no pudo guardarse en la base de datos.",
      guardado: false
    }, 500);
  }


  // ------------------------------------------
  // 11. DEVOLVER CAPÍTULO TRADUCIDO
  // ------------------------------------------

  return json({
    ok: true,
    chapter: body.chapter,
    title: chapter.title,
    paragraphs: translatedParagraphs,
    language: TARGET_LANGUAGE,
    cached: false,
    guardado: true,
    motores: stats
  });

}
