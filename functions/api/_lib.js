const COOKIE_NAME = "pm_biblioteca_session";
const SESSION_DAYS = 7;

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

export function cookieHeader(request, token, maxAge = SESSION_DAYS * 86400) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookie(request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

export function readCookie(request) {
  const raw = request.headers.get("Cookie") || "";
  const entry = raw.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE_NAME + "="));
  return entry ? entry.slice(COOKIE_NAME.length + 1) : null;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function randomId(bytes = 24) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function passwordHash(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function currentUser(request, env) {
  const token = readCookie(request);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > ?"
  ).bind(hash, new Date().toISOString()).first();
  return row || null;
}

export async function bodyJson(request) {
  try { return await request.json(); } catch { return null; }
}

export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch { return false; }
}
