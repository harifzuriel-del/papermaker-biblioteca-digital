
import {
  json,
  currentUser,
  bodyJsonLimited,
  sameOrigin,
  randomId
} from "../_lib.js";

const ALLOWED_COLORS = [
  "#ffe66d",
  "#a8e6a3",
  "#9ed8ff",
  "#ffb6cf",
  "#d8b8ff"
];

async function validateBook(env, userId, bookId, isPrivate) {
  if (isPrivate) {
    return await env.DB.prepare(
      "SELECT id FROM private_books WHERE id=? AND user_id=?"
    ).bind(bookId, userId).first();
  }

  return await env.DB.prepare(
    "SELECT id FROM books WHERE id=? AND published=1"
  ).bind(bookId).first();
}

export async function onRequestGet({ request, env }) {
  if (!sameOrigin(request)) {
    return json({ error: "Origen no permitido." }, 403);
  }

  const user = await currentUser(request, env);

  if (!user) {
    return json({ error: "Inicia sesión para consultar tus anotaciones." }, 401);
  }

  const url = new URL(request.url);
  const bookId = url.searchParams.get("bookId");
  const isPrivate = url.searchParams.get("private") === "1";

  if (!bookId) {
    return json({ error: "Falta el identificador del libro." }, 400);
  }

  const book = await validateBook(env, user.id, bookId, isPrivate);

  if (!book) {
    return json({ error: "Libro no encontrado o sin permisos." }, 404);
  }

  const table = isPrivate
    ? "private_reading_annotations"
    : "reading_annotations";

  const result = await env.DB.prepare(
    `SELECT
       id,
       type,
       chapter,
       paragraph_index AS paragraphIndex,
       start_offset AS startOffset,
       end_offset AS endOffset,
       selected_text AS selectedText,
       color,
       note,
       page_number AS pageNumber,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM ${table}
     WHERE user_id=? AND book_id=?
     ORDER BY chapter, paragraph_index, start_offset`
  ).bind(user.id, bookId).all();

  return json({
    ok: true,
    annotations: result.results || []
  });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) {
    return json({ error: "Origen no permitido." }, 403);
  }

  const user = await currentUser(request, env);

  if (!user) {
    return json({ error: "Inicia sesión para guardar anotaciones." }, 401);
  }

  const parsed = await bodyJsonLimited(request, 16384);

  if (!parsed.ok) {
    return json({ error: parsed.error }, parsed.status);
  }

  const body = parsed.data;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Los datos enviados no son válidos." }, 400);
  }

  const bookId = typeof body.bookId === "string"
    ? body.bookId.trim()
    : "";

  const isPrivate = body.isPrivate === true;
  const type = body.type;

  if (!bookId || bookId.length > 200) {
    return json({ error: "Identificador de libro no válido." }, 400);
  }

  if (!["highlight", "note", "bookmark"].includes(type)) {
    return json({ error: "Tipo de anotación no válido." }, 400);
  }

  const chapter = body.chapter;
  const paragraphIndex = body.paragraphIndex;
  const startOffset = body.startOffset ?? 0;
  const endOffset = body.endOffset ?? null;
  const selectedText = typeof body.selectedText === "string"
    ? body.selectedText
    : null;
  const color = body.color ?? null;
  const note = typeof body.note === "string"
    ? body.note.trim()
    : null;
  const pageNumber = body.pageNumber ?? null;

  if (
    !Number.isInteger(chapter) ||
    chapter < 0 ||
    chapter > 10000 ||
    !Number.isInteger(paragraphIndex) ||
    paragraphIndex < 0 ||
    paragraphIndex > 1000000 ||
    !Number.isInteger(startOffset) ||
    startOffset < 0 ||
    startOffset > 100000000
  ) {
    return json({ error: "La posición de la anotación no es válida." }, 400);
  }

  if (type === "highlight" || type === "note") {
    if (
      !Number.isInteger(endOffset) ||
      endOffset <= startOffset ||
      !selectedText ||
      !selectedText.trim() ||
      selectedText.length > 5000
    ) {
      return json({ error: "El texto seleccionado no es válido." }, 400);
    }
  }

  if (type === "highlight" && !ALLOWED_COLORS.includes(color)) {
    return json({ error: "El color seleccionado no es válido." }, 400);
  }

  if (type === "note") {
    if (!note || note.length > 10000) {
      return json({ error: "Escribe una nota válida de hasta 10,000 caracteres." }, 400);
    }
  }

  if (
    type === "bookmark" &&
    (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 1000000)
  ) {
    return json({ error: "El número de página no es válido." }, 400);
  }

  const book = await validateBook(env, user.id, bookId, isPrivate);

  if (!book) {
    return json({ error: "Libro no encontrado o sin permisos." }, 404);
  }

  const table = isPrivate
    ? "private_reading_annotations"
    : "reading_annotations";

  const id = randomId(16);

  await env.DB.prepare(
    `INSERT INTO ${table} (
      id,
      user_id,
      book_id,
      type,
      chapter,
      paragraph_index,
      start_offset,
      end_offset,
      selected_text,
      color,
      note,
      page_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    user.id,
    bookId,
    type,
    chapter,
    paragraphIndex,
    startOffset,
    endOffset,
    selectedText,
    type === "highlight" ? color : null,
    type === "note" ? note : null,
    type === "bookmark" ? pageNumber : null
  ).run();

  return json({
    ok: true,
    message: "Anotación guardada correctamente.",
    id
  }, 201);
}
