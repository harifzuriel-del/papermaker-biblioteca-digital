
import {
  json,
  currentUser,
  bodyJsonLimited,
  sameOrigin
} from "../_lib.js";

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) {
    return json({ error: "Origen no permitido." }, 403);
  }

  const user = await currentUser(request, env);

  if (!user) {
    return json(
      { error: "Inicia sesión para guardar tu progreso privado." },
      401
    );
  }

  const parsed = await bodyJsonLimited(request, 16384);

  if (!parsed.ok) {
    return json({ error: parsed.error }, parsed.status);
  }

  const body = parsed.data;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Los datos del progreso no son válidos." }, 400);
  }

  const chapter = body.chapter;
  const position = body.position;

  if (
    !Number.isInteger(chapter) ||
    chapter < 0 ||
    chapter > 10000 ||
    !Number.isInteger(position) ||
    position < 0 ||
    position > 100000000
  ) {
    return json({ error: "El capítulo o la posición no son válidos." }, 400);
  }

  const book = await env.DB.prepare(
    `SELECT id
     FROM private_books
     WHERE id = ? AND user_id = ?`
  ).bind(params.bookId, user.id).first();

  if (!book) {
    return json({ error: "Libro privado no encontrado." }, 404);
  }

  await env.DB.prepare(
    `INSERT INTO private_reading_progress
       (user_id, book_id, chapter, position, updated_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(user_id, book_id) DO UPDATE SET
       chapter = excluded.chapter,
       position = excluded.position,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
  ).bind(
    user.id,
    params.bookId,
    chapter,
    position
  ).run();

  return json({ ok: true });
}
