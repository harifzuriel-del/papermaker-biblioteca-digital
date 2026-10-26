
import {
  json,
  currentUser,
  bodyJson,
  sameOrigin,
  randomId
} from "../_lib.js";

function validateBook(body) {
  if (
  !body ||
  typeof body !== "object" ||
  Array.isArray(body)
) {
    return "Los datos del libro no son válidos.";
  }

  const title =
    typeof body.title === "string" ? body.title.trim() : "";

  const author =
    typeof body.author === "string"
      ? body.author.trim()
      : "Autor desconocido";

  if (!title || title.length > 200) {
    return "El título es obligatorio y no debe superar 200 caracteres.";
  }

  if (!author || author.length > 200) {
    return "El autor es obligatorio y no debe superar 200 caracteres.";
  }

  const content = body.content;

  if (
    !content ||
    typeof content !== "object" ||
    !Array.isArray(content.chapters) ||
    content.chapters.length < 1 ||
    content.chapters.length > 1000
  ) {
    return "El contenido debe incluir entre 1 y 1000 capítulos.";
  }

  let totalCharacters = 0;

  for (const chapter of content.chapters) {
    if (
      !chapter ||
      typeof chapter.title !== "string" ||
      !chapter.title.trim() ||
      chapter.title.length > 200 ||
      !Array.isArray(chapter.paragraphs) ||
      chapter.paragraphs.length > 5000
    ) {
      return "Hay un capítulo con un formato no válido.";
    }

    for (const paragraph of chapter.paragraphs) {
      if (typeof paragraph !== "string") {
        return "Todos los párrafos deben ser texto.";
      }

      totalCharacters += paragraph.length;

      if (totalCharacters > 1000000) {
        return "El libro supera el límite de un millón de caracteres.";
      }
    }
  }

  return null;
}

export async function onRequestGet({ request, env }) {
  const user = await currentUser(request, env);

  if (!user) {
    return json({ error: "Inicia sesión para ver tus libros privados." }, 401);
  }

  const result = await env.DB.prepare(
    `SELECT id, title, author, created_at AS createdAt,
            updated_at AS updatedAt
     FROM private_books
     WHERE user_id = ?
     ORDER BY updated_at DESC, title COLLATE NOCASE`
  ).bind(user.id).all();

  return json({ books: result.results || [] });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) {
    return json({ error: "Origen no permitido." }, 403);
  }

  const user = await currentUser(request, env);

  if (!user) {
    return json({ error: "Inicia sesión para guardar libros privados." }, 401);
  }

  const body = await bodyJson(request);

  if (!body) {
    return json({ error: "La solicitud no contiene JSON válido." }, 400);
  }

  const validationError = validateBook(body);

  if (validationError) {
    return json({ error: validationError }, 400);
  }

  const title = body.title.trim();
  const author = body.author.trim();
  const contentJson = JSON.stringify(body.content);

  const id = randomId(16);

  await env.DB.prepare(
    `INSERT INTO private_books
       (id, user_id, title, author, content_json)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(
    id,
    user.id,
    title,
    author,
    contentJson
  ).run();

  return json({
    ok: true,
    book: { id, title, author }
  }, 201);
}
