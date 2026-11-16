
import {
  json,
  currentUser,
  bodyJsonLimited,
  sameOrigin
} from "../_lib.js";

const ALLOWED_COLORS = [
  "#ffe66d",
  "#a8e6a3",
  "#9ed8ff",
  "#ffb6cf",
  "#d8b8ff"
];

async function findAnnotation(env, userId, id, isPrivate) {
  const table = isPrivate
    ? "private_reading_annotations"
    : "reading_annotations";

  return await env.DB.prepare(
    `SELECT id, type
     FROM ${table}
     WHERE id=? AND user_id=?`
  ).bind(id, userId).first();
}

export async function onRequestPut({ request, env, params }) {
  if (!sameOrigin(request)) {
    return json({ error: "Origen no permitido." }, 403);
  }

  const user = await currentUser(request, env);

  if (!user) {
    return json({ error: "Inicia sesión para editar anotaciones." }, 401);
  }

  const parsed = await bodyJsonLimited(request, 16384);

  if (!parsed.ok) {
    return json({ error: parsed.error }, parsed.status);
  }

  const body = parsed.data;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Los datos enviados no son válidos." }, 400);
  }

  const id = params.id;
  const isPrivate = body.isPrivate === true;

  if (!id || id.length > 200) {
    return json({ error: "Identificador de anotación no válido." }, 400);
  }

  const annotation = await findAnnotation(env, user.id, id, isPrivate);

  if (!annotation) {
    return json({ error: "Anotación no encontrada." }, 404);
  }

  if (annotation.type !== "note") {
    return json({
      error: "Por ahora solamente se pueden editar las notas personales."
    }, 400);
  }

  if (
    typeof body.note !== "string" ||
    !body.note.trim() ||
    body.note.trim().length > 10000
  ) {
    return json({ error: "Escribe una nota válida de hasta 10,000 caracteres." }, 400);
  }

  const table = isPrivate
    ? "private_reading_annotations"
    : "reading_annotations";

  await env.DB.prepare(
    `UPDATE ${table}
     SET note=?,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id=? AND user_id=?`
  ).bind(body.note.trim(), id, user.id).run();

  return json({
    ok: true,
    message: "Nota actualizada correctamente."
  });
}

export async function onRequestDelete({ request, env, params }) {
  if (!sameOrigin(request)) {
    return json({ error: "Origen no permitido." }, 403);
  }

  const user = await currentUser(request, env);

  if (!user) {
    return json({ error: "Inicia sesión para eliminar anotaciones." }, 401);
  }

  const url = new URL(request.url);
  const isPrivate = url.searchParams.get("private") === "1";
  const id = params.id;

  if (!id || id.length > 200) {
    return json({ error: "Identificador de anotación no válido." }, 400);
  }

  const table = isPrivate
    ? "private_reading_annotations"
    : "reading_annotations";

  const result = await env.DB.prepare(
    `DELETE FROM ${table}
     WHERE id=? AND user_id=?`
  ).bind(id, user.id).run();

  if (!result.meta?.changes) {
    return json({ error: "Anotación no encontrada." }, 404);
  }

  return json({
    ok: true,
    message: "Anotación eliminada correctamente."
  });
}
