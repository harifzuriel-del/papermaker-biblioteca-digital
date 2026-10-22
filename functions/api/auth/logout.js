import { json, clearCookie, readCookie, sha256Hex, sameOrigin } from "../_lib.js";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  const token = readCookie(request);
  if (token) {
    const hash = await sha256Hex(token);
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(hash).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie(request) });
}
