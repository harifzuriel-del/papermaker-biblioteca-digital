
import {
  json,
  currentUser,
  bodyJsonLimited,
  sameOrigin
} from "../../_lib.js";

// ==========================================
// CONFIGURACIÓN DE TRADUCCIÓN
// ==========================================

const MAX_CHAPTER_LENGTH = 120000;
const MAX_CHUNK_LENGTH = 4000;
const TRANSLATION_TIMEOUT = 45000;


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

    // Si la oración cabe, intentamos agregarla completa.
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

    // Si una oración es demasiado larga,
    // la dividimos por palabras.

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

    if (wordChunk) {
      current = wordChunk;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}


// ==========================================
// TRADUCIR UN FRAGMENTO
// ==========================================

async function translateChunk(text, translatorUrl) {

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

      signal: AbortSignal.timeout(TRANSLATION_TIMEOUT)
    }
  );

  if (!response.ok) {
    throw new Error(
      `El servicio de traducción respondió con HTTP ${response.status}.`
    );
  }

  const translation = await response.json();

  if (
    !translation ||
    typeof translation.translatedText !== "string" ||
    !translation.translatedText.trim()
  ) {
    throw new Error("El traductor devolvió una respuesta vacía.");
  }

  return translation.translatedText.trim();
}


// ==========================================
// TRADUCIR UN PÁRRAFO COMPLETO
// ==========================================

async function translateParagraph(paragraph, translatorUrl) {

  const chunks = splitIntoChunks(paragraph);

  const translatedParts = [];

  // Se traducen secuencialmente para no sobrecargar
  // el servicio gratuito de LibreTranslate.

  for (const chunk of chunks) {

    const translated = await translateChunk(
      chunk,
      translatorUrl
    );

    translatedParts.push(translated);
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
  // 7. VALIDAR TAMAÑO DEL CAPÍTULO
  // ------------------------------------------

  const paragraphs = chapter.paragraphs;

  const originalText = paragraphs.join("\n\n");

  if (!originalText.trim()) {
    return json({
      error: "El capítulo no contiene texto para traducir."
    }, 400);
  }

  // Límite de seguridad para evitar procesamientos
  // excesivamente grandes en el servicio gratuito.

  if (originalText.length > MAX_CHAPTER_LENGTH) {
    return json({
      error: "El capítulo supera el límite de 120,000 caracteres. Intenta dividirlo en capítulos más pequeños."
    }, 413);
  }


  // ------------------------------------------
  // 8. COMPROBAR SERVICIO DE TRADUCCIÓN
  // ------------------------------------------

  const translatorUrl = env.LIBRETRANSLATE_URL;

  if (!translatorUrl) {
    return json({
      error: "El servicio de traducción no está configurado."
    }, 500);
  }


  // ------------------------------------------
  // 9. TRADUCIR PÁRRAFOS POR FRAGMENTOS
  // ------------------------------------------

  const translatedParagraphs = [];

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
        translatorUrl
      );

      translatedParagraphs.push(translated);
    }

  } catch (error) {

    console.error(
      "Error durante la traducción:",
      error
    );

    const message =
      error?.name === "TimeoutError" ||
      error?.name === "AbortError"
        ? "El servicio de traducción tardó demasiado. Intenta nuevamente."
        : "No se pudo completar la traducción. Comprueba que LibreTranslate esté funcionando e inténtalo nuevamente.";

    return json({
      error: message
    }, 502);
  }


  // ------------------------------------------
  // 10. DEVOLVER CAPÍTULO TRADUCIDO
  // ------------------------------------------

  return json({
    ok: true,
    chapter: body.chapter,
    title: chapter.title,
    paragraphs: translatedParagraphs,
    language: "es"
  });

}
