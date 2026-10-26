
import {
  json,
  currentUser
} from "../_lib.js";

export async function onRequestGet({ request, env }) {
  const user = await currentUser(request, env);

  if (!user) {
    return json(
      { error: "Inicia sesión para consultar tu progreso privado." },
      401
    );
  }

  const result = await env.DB.prepare(
    `SELECT p.book_id AS bookId,
            p.chapter,
            p.position,
            p.updated_at AS updatedAt
     FROM private_reading_progress p
     INNER JOIN private_books b
       ON b.id = p.book_id
      AND b.user_id = p.user_id
     WHERE p.user_id = ?
     ORDER BY p.updated_at DESC`
  ).bind(user.id).all();

  return json({ progress: result.results || [] });
}
