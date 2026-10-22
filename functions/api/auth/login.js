import { json, cookieHeader, randomId, sha256Hex, passwordHash, bodyJson, sameOrigin } from "../_lib.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const body = await bodyJson(request);
  if (!body) return json({ error: "Solicitud inválida." }, 400);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) return json({ error: "Escribe tu correo y contraseña." }, 400);

  const user = await env.DB.prepare("SELECT id,name,email,password_hash,password_salt FROM users WHERE email=?").bind(email).first();
  if (!user) return json({ error: "Correo o contraseña incorrectos." }, 401);
  const hash = await passwordHash(password, user.password_salt);
  if (hash !== user.password_hash) return json({ error: "Correo o contraseña incorrectos." }, 401);

  const token = randomId(32);
  const tokenHash = await sha256Hex(token);
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").bind(tokenHash, user.id, expires).run();

  return json({ user: { id: user.id, name: user.name, email: user.email } }, 200, { "Set-Cookie": cookieHeader(request, token) });
}
