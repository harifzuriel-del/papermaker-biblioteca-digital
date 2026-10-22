import { json } from "../_lib.js";

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const category = (url.searchParams.get("category") || "").trim().slice(0, 80);
  let sql = "SELECT id,title,author,category,description,language,rights_note,cover_color FROM books WHERE published=1";
  const params = [];
  if (q) {
    sql += " AND (title LIKE ? OR author LIKE ? OR description LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category && category !== "Todas") {
    sql += " AND category=?";
    params.push(category);
  }
  sql += " ORDER BY title COLLATE NOCASE LIMIT 100";
  const stmt = env.DB.prepare(sql);
  const result = await (params.length ? stmt.bind(...params) : stmt).all();
  return json({ books: result.results || [] });
}
