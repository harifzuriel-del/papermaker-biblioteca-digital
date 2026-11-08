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
const MAX_CHUNK_LENGTH = 350;
const DEFAULT_BATCH_SIZE = 3;
const MAX_BATCH_SIZE = 5;

const AI_MODEL = "@cf/meta/m2m100-1.2b";
const SOURCE_LANGUAGE = "en";
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
      if (current && current.length + part.length + 1 > maxLength) {
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
      if (wordChunk && wordChunk.length + word.length + 1 > maxLength) {
        chunks.push(wordChunk);
        wordChunk = "";
      }

      wordChunk += (wordChunk ? " " : "") + word;
    }

    if (wordChunk) chunks.push(wordChunk);
  }

  if (current) chunks.push(current);

  return chunks;
}

// ==========================================
// WORKERS AI
// ==========================================

async function translateWithWorkersAI(text, env) {
  if (!env.AI) {
    throw new Error("El binding Workers AI no está disponible.");
  }

  const result = await env.AI.run(AI_MODEL, {
    text,
    source_lang: SOURCE_LANGUAGE,
    target_lang: TARGET_LANGUAGE
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
// LIBRETRANSLATE
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
        source: SOURCE_LANGUAGE,
        target: TARGET_LANGUAGE,
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
// ==========================================

async function translateChunk(text, env) {
  try {
    return {
      text: await translateWithWorkersAI(text, env),
      motor: "workers-ai"
    };
  } catch (aiError) {
    console.error(
      "Workers AI falló. Se intentará LibreTranslate:",
      aiError
    );

    try {
      return {
        text: await translateWithLibreTranslate(text, env),
        motor: "libretranslate"
      };
    } catch (fallbackError) {
      console.error("También falló LibreTranslate:", fallbackError);

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
// CONSULTAR TRADUCCIÓN COMPLETA
// ==========================================

async function getCompleteTranslation(
  env,
  book,
  user,
  chapterIndex,
  paragraphCount
) {
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
    chapterIndex,
    TARGET_LANGUAGE
  ).first();

  if (!saved) return null;

  try {
    const paragraphs = JSON.parse(saved.paragraphs_json);

    if (
      Array.isArray(paragraphs) &&
      paragraphs.length === paragraphCount &&
      paragraphs.every(value => typeof value === "string")
    ) {
      return paragraphs;
    }
  } catch (error) {
    console.error("La caché completa no contiene JSON válido:", error);
  }

  return null;
}

// ==========================================
// CONSULTAR PÁRRAFOS YA TRADUCIDOS
// ==========================================

async function getSavedParts(
  env,
  book,
  user,
  chapterIndex,
  paragraphCount
) {
  const result = await env.DB.prepare(
    `SELECT paragraph_index, translated_text
     FROM private_book_translation_parts
     WHERE book_id = ?
       AND user_id = ?
       AND chapter_index = ?
       AND target_language = ?
       AND paragraph_index >= 0
       AND paragraph_index < ?
     ORDER BY paragraph_index ASC`
  ).bind(
    String(book.id),
    String(user.id),
    chapterIndex,
    TARGET_LANGUAGE,
    paragraphCount
  ).all();

  const saved = new Map();

  for (const row of result.results || []) {
    saved.set(
      Number(row.paragraph_index),
      row.translated_text
    );
  }

  return saved;
}

// ==========================================
// GUARDAR UN PÁRRAFO INMEDIATAMENTE
// ==========================================

async function saveTranslatedPart(
  env,
  book,
  user,
  chapterIndex,
  paragraphIndex,
  translatedText
) {
  await env.DB.prepare(
    `INSERT INTO private_book_translation_parts
     (
       book_id,
       user_id,
       chapter_index,
       target_language,
       paragraph_index,
       translated_text,
       updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (
       book_id,
       user_id,
       chapter_index,
       target_language,
       paragraph_index
     )
     DO UPDATE SET
       translated_text = excluded.translated_text,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    String(book.id),
    String(user.id),
    chapterIndex,
    TARGET_LANGUAGE,
    paragraphIndex,
    translatedText
  ).run();
}

// ==========================================
// GUARDAR CAPÍTULO COMPLETO
// ==========================================

async function saveCompleteTranslation(
  env,
  book,
  user,
  chapterIndex,
  translatedParagraphs
) {
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
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP
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
    chapterIndex,
    TARGET_LANGUAGE,
    JSON.stringify(translatedParagraphs)
  ).run();
}

// ==========================================
// ENDPOINT PRINCIPAL
// ==========================================

export async function onRequestPost({ request, env, params }) {

  // ----------------------------------------
  // 1. VALIDAR ORIGEN
  // ----------------------------------------

  if (!sameOrigin(request)) {
    return json({
      error: "Origen no permitido."
    }, 403);
  }

  // ----------------------------------------
  // 2. VALIDAR SESIÓN
  // ----------------------------------------

  const user = await currentUser(request, env);

  if (!user) {
    return json({
      error: "Inicia sesión para traducir tus libros."
    }, 401);
  }

  // ----------------------------------------
  // 3. LEER SOLICITUD
  // ----------------------------------------

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

  // batchSize activa el modo por bloques.
  // Sin batchSize se conserva el comportamiento anterior.

  const batchMode = body.batchSize !== undefined;

  const batchSize = batchMode
    ? body.batchSize
    : DEFAULT_BATCH_SIZE;

  const startIndex = batchMode
    ? (body.startIndex ?? 0)
    : 0;

  if (
    !Number.isInteger(startIndex) ||
    startIndex < 0 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_BATCH_SIZE
  ) {
    return json({
      error: "Los parámetros del bloque de traducción no son válidos."
    }, 400);
  }

  // ----------------------------------------
  // 4. BUSCAR LIBRO DEL USUARIO
  // ----------------------------------------

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

  // ----------------------------------------
  // 5. VALIDAR IDIOMA DE ORIGEN
  // ----------------------------------------

  if (book.language !== SOURCE_LANGUAGE) {
    return json({
      error: "Por ahora la traducción está configurada para libros en inglés."
    }, 400);
  }

  // ----------------------------------------
  // 6. LEER CAPÍTULO
  // ----------------------------------------

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

  const paragraphs = chapter.paragraphs;

  // ----------------------------------------
  // 7. VALIDAR CONTENIDO
  // ----------------------------------------

  if (
    paragraphs.some(
      paragraph => typeof paragraph !== "string"
    )
  ) {
    return json({
      error: "El capítulo contiene párrafos con formato no válido."
    }, 400);
  }

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

  const chapterIndex = body.chapter;
  const total = paragraphs.length;

  // ----------------------------------------
  // 8. REVISAR CACHÉ COMPLETA
  // ----------------------------------------

  try {
    const complete = await getCompleteTranslation(
      env,
      book,
      user,
      chapterIndex,
      total
    );

    if (complete) {
      if (batchMode) {
        return json({
          ok: true,
          chapter: chapterIndex,
          title: chapter.title,
          complete: true,
          cached: true,
          total,
          completed: total,
          nextIndex: total,
          progress: 100,
          paragraphs: complete,
          items: []
        });
      }

      return json({
        ok: true,
        chapter: chapterIndex,
        title: chapter.title,
        paragraphs: complete,
        language: TARGET_LANGUAGE,
        cached: true,
        motor: "database"
      });
    }
  } catch (error) {
    console.error("Error consultando traducción completa:", error);

    return json({
      error: "No se pudo consultar la traducción guardada."
    }, 500);
  }

  // ----------------------------------------
  // 9. RECUPERAR PROGRESO
  // ----------------------------------------

  let savedParts;

  try {
    savedParts = await getSavedParts(
      env,
      book,
      user,
      chapterIndex,
      total
    );
  } catch (error) {
    console.error("Error recuperando progreso:", error);

    return json({
      error: "No se pudo recuperar el progreso de traducción."
    }, 500);
  }

  // ----------------------------------------
  // 10. DETERMINAR PÁRRAFOS PENDIENTES
  // ----------------------------------------

  let indexes;

  if (batchMode) {
    indexes = [];

    for (
      let i = startIndex;
      i < Math.min(startIndex + batchSize, total);
      i++
    ) {
      if (!savedParts.has(i)) {
        indexes.push(i);
      }
    }

    // Si los primeros párrafos ya estaban guardados,
    // avanzar hasta encontrar trabajo pendiente.

    if (indexes.length === 0) {
      for (let i = 0; i < total; i++) {
        if (!savedParts.has(i)) {
          indexes.push(i);
          if (indexes.length >= batchSize) break;
        }
      }
    }
  } else {
    indexes = [];

    for (let i = 0; i < total; i++) {
      if (!savedParts.has(i)) {
        indexes.push(i);
      }
    }
  }

  // ----------------------------------------
  // 11. TRADUCIR Y GUARDAR CADA PÁRRAFO
  // ----------------------------------------

  const stats = {
    workersAI: 0,
    libreTranslate: 0
  };

  const items = [];

  try {
    for (const index of indexes) {
      const paragraph = paragraphs[index];

      let translated = "";

      if (paragraph.trim()) {
        translated = await translateParagraph(
          paragraph,
          env,
          stats
        );
      }

      // Guardado inmediato:
      // si la petición se interrumpe después,
      // este párrafo ya estará disponible en D1.

      await saveTranslatedPart(
        env,
        book,
        user,
        chapterIndex,
        index,
        translated
      );

      savedParts.set(index, translated);

      items.push({
        index,
        text: translated
      });
    }
  } catch (error) {
    console.error("Error durante la traducción:", error);
          // este párrafo ya estará disponible en D1.

      await saveTranslatedPart(
        env,
        book,
        user,
        chapterIndex,
        index,
        translated
      );

      savedParts.set(index, translated);

      items.push({
        index,
        text: translated
      });
    }
  } catch (error) {
    console.error("Error durante la traducción:", error);

    return json({
      ok: false,
      error: error?.message ||
        "No se pudo completar este bloque.",
      guardado: true,
      items,
      completed: savedParts.size,
      total,
      progress: Math.floor(
        (savedParts.size / total) * 100
      )
    }, 502);
  }

  // ----------------------------------------
  // 12. COMPROBAR SI TERMINÓ EL CAPÍTULO
  // ----------------------------------------

  const complete = savedParts.size === total;

  if (complete) {
    const translatedParagraphs = [];

    for (let i = 0; i < total; i++) {
      if (!savedParts.has(i)) {
        return json({
          error: "Falta un párrafo por recuperar.",
          guardado: true
        }, 500);
      }

      translatedParagraphs.push(savedParts.get(i));
    }

    // Guardar también la caché completa anterior.

    try {
      await saveCompleteTranslation(
        env,
        book,
        user,
        chapterIndex,
        translatedParagraphs
      );
    } catch (error) {
      console.error("Error guardando capítulo completo:", error);

      return json({
        error: "Los párrafos están guardados, pero no se pudo actualizar la caché completa.",
        guardado: true
      }, 500);
    }

    if (!batchMode) {
      return json({
        ok: true,
        chapter: chapterIndex,
        title: chapter.title,
        paragraphs: translatedParagraphs,
        language: TARGET_LANGUAGE,
        cached: false,
        guardado: true,
        motores: stats
      });
    }

    return json({
      ok: true,
      chapter: chapterIndex,
      title: chapter.title,
      complete: true,
      cached: false,
      language: TARGET_LANGUAGE,
      total,
      completed: total,
      nextIndex: total,
      progress: 100,
      paragraphs: translatedParagraphs,
      items,
      motores: stats
    });
  }

  // ----------------------------------------
  // 13. DEVOLVER AVANCE DEL BLOQUE
  // ----------------------------------------

  let nextIndex = 0;

  while (
    nextIndex < total &&
    savedParts.has(nextIndex)
  ) {
    nextIndex++;
  }

  if (!batchMode) {
    // Compatibilidad temporal con el frontend anterior.
    // Devuelve el avance guardado en D1, aunque el capítulo
    // todavía no esté completo.

    return json({
      ok: true,
      chapter: chapterIndex,
      title: chapter.title,
      paragraphs: Array.from(
        { length: total },
        (_, i) => savedParts.get(i) ?? ""
      ),
      complete: false,
      guardado: true,
      total,
      completed: savedParts.size,
      nextIndex,
      progress: Math.floor(
        (savedParts.size / total) * 100
      ),
      motores: stats
    });
  }

  return json({
    ok: true,
    chapter: chapterIndex,
    title: chapter.title,
    complete: false,
    cached: false,
    language: TARGET_LANGUAGE,
    total,
    completed: savedParts.size,
    nextIndex,
    progress: Math.floor(
      (savedParts.size / total) * 100
    ),
    items,
    motores: stats
  });
}


// ==========================================
// CONSULTAR TRADUCCIÓN GUARDADA
// GET /api/private-books/:id/translate?chapter=0
// Esta ruta SOLO consulta D1.
// No inicia traducciones ni consume motores.
// ==========================================

export async function onRequestGet({ request, env, params }) {
  try {
    // 1. Validar origen
    if (!sameOrigin(request)) {
      return json({
        error: "Origen no permitido."
      }, 403);
    }

    // 2. Validar sesión
    const user = await currentUser(request, env);

    if (!user) {
      return json({
        error: "Inicia sesión para consultar tus traducciones."
      }, 401);
    }

    // 3. Validar capítulo solicitado
    const url = new URL(request.url);
    const chapterIndex = Number(url.searchParams.get("chapter"));

    if (
      !Number.isInteger(chapterIndex) ||
      chapterIndex < 0
    ) {
      return json({
        error: "El capítulo solicitado no es válido."
      }, 400);
    }

    // 4. Buscar libro perteneciente al usuario
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

    if (book.language !== SOURCE_LANGUAGE) {
      return json({
        error: "El libro no está en inglés."
      }, 400);
    }

    // 5. Leer contenido del libro
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
      chapterIndex >= content.chapters.length
    ) {
      return json({
        error: "El capítulo solicitado no existe."
      }, 404);
    }

    const chapter = content.chapters[chapterIndex];

    if (
      !chapter ||
      !Array.isArray(chapter.paragraphs)
    ) {
      return json({
        error: "El capítulo no contiene párrafos válidos."
      }, 400);
    }

    const total = chapter.paragraphs.length;

    // 6. Consultar primero la caché completa
    const completeTranslation = await getCompleteTranslation(
      env,
      book,
      user,
      chapterIndex,
      total
    );

    if (completeTranslation) {
      return json({
        ok: true,
        complete: true,
        cached: true,
        chapter: chapterIndex,
        title: chapter.title,
        language: TARGET_LANGUAGE,
        total,
        completed: total,
        nextIndex: total,
        progress: 100,
        paragraphs: completeTranslation
      });
    }

    // 7. Si no hay caché completa, consultar párrafos guardados
    const savedParts = await getSavedParts(
      env,
      book,
      user,
      chapterIndex,
      total
    );

    // Si todos los párrafos están guardados, reconstruir
    // la traducción completa desde la tabla de partes.
    if (savedParts.size === total) {
      const translatedParagraphs = [];

      for (let i = 0; i < total; i++) {
        if (!savedParts.has(i)) {
          return json({
            ok: false,
            error: "La traducción todavía tiene párrafos pendientes."
          }, 500);
        }

        translatedParagraphs.push(savedParts.get(i));
      }

      // Intentar actualizar la caché completa para futuras consultas.
      try {
        await saveCompleteTranslation(
          env,
          book,
          user,
          chapterIndex,
          translatedParagraphs
        );
      } catch (error) {
        // La traducción sigue siendo recuperable desde las partes.
        console.error(
          "No se pudo reconstruir la caché completa:",
          error
        );
      }

      return json({
        ok: true,
        complete: true,
        cached: true,
        chapter: chapterIndex,
        title: chapter.title,
        language: TARGET_LANGUAGE,
        total,
        completed: total,
        nextIndex: total,
        progress: 100,
        paragraphs: translatedParagraphs
      });
    }

    // 8. Si está incompleta, informar avance sin traducir nada.
    let nextIndex = 0;

    while (
      nextIndex < total &&
      savedParts.has(nextIndex)
    ) {
      nextIndex++;
    }

    return json({
      ok: true,
      complete: false,
      cached: false,
      chapter: chapterIndex,
      title: chapter.title,
      language: TARGET_LANGUAGE,
      total,
      completed: savedParts.size,
      nextIndex,
      progress: total
        ? Math.floor((savedParts.size / total) * 100)
        : 0
    });

  } catch (error) {
    console.error(
      "Error consultando traducción guardada:",
      error
    );

    return json({
      error: "No se pudo consultar la traducción guardada."
    }, 500);
  }
}
