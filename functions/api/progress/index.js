import { json, currentUser } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Inicia sesión para sincronizar tu lectura." }, 401);
  const result = await env.DB.prepare(
    "SELECT book_id AS bookId, chapter, position, updated_at AS updatedAt FROM reading_progress WHERE user_id=?"
  ).bind(user.id).all();
  return json({ progress: result.results || [] });
}
