import { json, cookieHeader, randomId, sha256Hex, passwordHash, bodyJson, sameOrigin } from "../_lib.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const body = await bodyJson(request);
  if (!body) return json({ error: "Solicitud inválida." }, 400);

  const name = String(body.name || "").trim().slice(0, 80);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (name.length < 2) return json({ error: "Escribe tu nombre (mínimo 2 caracteres)." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) return json({ error: "Correo electrónico inválido." }, 400);
  if (password.length < 10 || password.length > 200) return json({ error: "La contraseña debe tener entre 10 y 200 caracteres." }, 400);

  const id = randomId(16);
  const salt = randomId(16);
  const hash = await passwordHash(password, salt);

  try {
    await env.DB.prepare("INSERT INTO users (id,name,email,password_hash,password_salt) VALUES (?,?,?,?,?)")
      .bind(id, name, email, hash, salt).run();
  } catch {
    return json({ error: "No pudimos crear la cuenta. Es posible que ese correo ya esté registrado." }, 409);
  }

  const token = randomId(32);
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)")
    .bind(tokenHash, id, expires).run();

  return json({ user: { id, name, email } }, 201, { "Set-Cookie": cookieHeader(request, token) });
}
