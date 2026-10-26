
import {
  json,
  currentUser,
  bodyJsonLimited,
  sameOrigin
} from "../_lib.js";

async function ownedBook(env, userId, bookId) {
  return env.DB.prepare(
    `SELECT id, title, author, content_json,
            created_at, updated_at
     FROM private_books
     WHERE id = ? AND user_id = ?`
  ).bind(bookId, userId).first();
}

function validContent(content) {
  if (
    !content ||
    typeof content !== "object" ||
    Array.isArray(content) ||
    !Array.isArray(content.chapters) ||
    content.chapters.length < 1 ||
    content.chapters.length > 1000
  ) {
    return false;
  }

  let total = 0;

  for (const chapter of content.chapters) {
    if (
      !chapter ||
      typeof chapter.title !== "string" ||
      !chapter.title.trim() ||
      chapter.title.length > 200 ||
      !Array.isArray(chapter.paragraphs) ||
      chapter.paragraphs.length > 5000
    ) {
      return false;
    }

    for (const paragraph of chapter.paragraphs) {
      if (typeof paragraph !== "string") return false;
      total += paragraph.length;
      if (total > 1000000) return false;
    }
  }

  return true;
}

export async function onRequestGet({ request, env, params }) {
  const user = await currentUser(request, env);

  if (!user) {
    return json({ error: "Inicia sesión para abrir tus libros privados." }, 401);
  }

  const book = await ownedBook(env, user.id, params.id);

  if (!book) {
    return json({ error: "Libro privado no encontrado." }, 404);
  }

  let content;

  try {
    content = JSON.parse(book.content_json);
  } catch {
    return json({ error: "No se pudo leer el contenido del libro." }, 500);
  }

  delete book.content_json;

  return json({ book, content });
}

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) {
    return json({ error: "Origen no permitido." }, 403);
  }

  const user = await currentUser(request, env);

  if (!user) {
    return json({ error: "Inicia sesión para editar tus libros privados." }, 401);
  }

  const parsed = await bodyJsonLimited(request);

if (!parsed.ok) {
  return json({ error: parsed.error }, parsed.status);
}

const body = parsed.data;

if (!body || typeof body !== "object" || Array.isArray(body)) {
  return json({ error: "La solicitud no contiene JSON válido." }, 400);
}

  const title =
    typeof body.title === "string" ? body.title.trim() : "";
  const author =
    typeof body.author === "string" ? body.author.trim() : "";

  if (!title || title.length > 200) {
    return json({ error: "El título es obligatorio y no debe superar 200 caracteres." }, 400);
  }

  if (!author || author.length > 200) {
    return json({ error: "El autor es obligatorio y no debe superar 200 caracteres." }, 400);
  }

  if (!validContent(body.content)) {
    return json({ error: "El contenido del libro no tiene un formato válido." }, 400);
  }

  const result = await env.DB.prepare(
    `UPDATE private_books
     SET title = ?, author = ?, content_json = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`
  ).bind(
    title,
    author,
    JSON.stringify(body.content),
    params.id,
    user.id
  ).run();

  if (!result.meta?.changes) {
    return json({ error: "Libro privado no encontrado." }, 404);
  }

  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  if (!sameOrigin(request)) {
    return json({ error: "Origen no permitido." }, 403);
  }

  const user = await currentUser(request, env);

  if (!user) {
    return json({ error: "Inicia sesión para eliminar tus libros privados." }, 401);
  }

  const result = await env.DB.prepare(
    `DELETE FROM private_books
     WHERE id = ? AND user_id = ?`
  ).bind(params.id, user.id).run();

  if (!result.meta?.changes) {
    return json({ error: "Libro privado no encontrado." }, 404);
  }

  return json({ ok: true });
}
