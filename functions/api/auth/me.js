import { json, currentUser } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  const user = await currentUser(request, env);
  return json({ user });
}
