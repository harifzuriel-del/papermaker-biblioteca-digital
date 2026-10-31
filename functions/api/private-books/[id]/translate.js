
import {
  json,
  currentUser,
  bodyJsonLimited,
  sameOrigin
} from "../../_lib.js";


export async function onRequestPost({ request, env, params }) {

  // ------------------------------------------
  // 1. VALIDAR ORIGEN
  // ------------------------------------------

  if (!sameOrigin(request)) {
    return json({ error: "Origen no permitido." }, 403);
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
    return json({ error: parsed.error }, parsed.status);
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
  // 7. LIMITAR TAMAÑO DEL CAPÍTULO
  // ------------------------------------------

  const paragraphs = chapter.paragraphs;

  const originalText = paragraphs.join("\n\n");

  if (originalText.length > 30000) {
    return json({
      error: "Este capítulo es demasiado largo. Intenta con un capítulo más corto."
    }, 413);
  }


  // ------------------------------------------
  // 8. CONECTAR CON LIBRETRANSLATE
  // ------------------------------------------

  const translatorUrl = env.LIBRETRANSLATE_URL;

  if (!translatorUrl) {
    return json({
      error: "El servicio de traducción no está configurado."
    }, 500);
  }

  let translation;

  try {

    const response = await fetch(
      translatorUrl.replace(/\/+$/, "") + "/translate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          q: originalText,
          source: "en",
          target: "es",
          format: "text"
        })
      }
    );

    if (!response.ok) {
      return json({
        error: "El servicio de traducción no está disponible en este momento."
      }, 502);
    }

    translation = await response.json();

  } catch {
    return json({
      error: "No se pudo conectar con el servicio de traducción."
    }, 502);
  }


  // ------------------------------------------
  // 9. VALIDAR RESPUESTA
  // ------------------------------------------

  if (
    !translation ||
    typeof translation.translatedText !== "string" ||
    !translation.translatedText.trim()
  ) {
    return json({
      error: "El traductor no devolvió un resultado válido."
    }, 502);
  }


  // ------------------------------------------
  // 10. DEVOLVER TRADUCCIÓN
  // ------------------------------------------

  return json({
    ok: true,
    chapter: body.chapter,
    title: chapter.title,
    paragraphs: translation.translatedText.split(/\n\s*\n/),
    language: "es"
  });

}

