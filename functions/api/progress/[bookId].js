import { json, currentUser, bodyJson, sameOrigin } from "../_lib.js";

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Inicia sesión para sincronizar tu lectura." }, 401);
  const body = await bodyJson(request);
  if (!body) return json({ error: "Solicitud inválida." }, 400);
  const chapter = Number.isInteger(body.chapter) ? Math.max(0, Math.min(body.chapter, 10000)) : 0;
  const position = Number.isInteger(body.position) ? Math.max(0, Math.min(body.position, 100000000)) : 0;
  const book = await env.DB.prepare("SELECT id FROM books WHERE id=? AND published=1").bind(params.bookId).first();
  if (!book) return json({ error: "Libro no encontrado." }, 404);
  await env.DB.prepare(
    `INSERT INTO reading_progress (user_id,book_id,chapter,position,updated_at)
     VALUES (?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(user_id,book_id) DO UPDATE SET
       chapter=excluded.chapter, position=excluded.position, updated_at=excluded.updated_at`
  ).bind(user.id, params.bookId, chapter, position).run();
  return json({ ok: true });
}
