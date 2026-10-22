import { json } from "../_lib.js";

export async function onRequestGet({ env, params }) {
  const book = await env.DB.prepare(
    "SELECT id,title,author,category,description,language,rights_note,cover_color,content_json FROM books WHERE id=? AND published=1"
  ).bind(params.id).first();
  if (!book) return json({ error: "Libro no encontrado." }, 404);
  let content;
  try { content = JSON.parse(book.content_json); } catch { return json({ error: "El contenido del libro no se pudo leer." }, 500); }
  delete book.content_json;
  return json({ book, content });
}
