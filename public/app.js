const $ = (s) => document.querySelector(s);
const state = { books: [], user: null, authMode: "login", currentBook: null, content: null, chapter: 0, fontSize: 19, progress: {}, saveTimer: null, utterance: null };

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3000);
}
function cover(book) {
  return `<div class="cover" style="background:${esc(book.cover_color || "#e9e4d8")}"><div class="cover-mark"><span>PM / ${esc(book.category.toUpperCase())}</span><b>${esc(book.title)}</b><small>PAPERMAKER · BIBLIOTECA</small></div></div>`;
}
function renderBooks() {
  const query = $("#searchInput").value.trim().toLocaleLowerCase("es-MX");
  const category = $("#categorySelect").value;
  const books = state.books.filter(b => (!query || `${b.title} ${b.author} ${b.description} ${b.category}`.toLocaleLowerCase("es-MX").includes(query)) && (category === "Todas" || b.category === category));
  $("#catalogCount").textContent = `${books.length} ${books.length === 1 ? "libro" : "libros"}`;
  $("#bookGrid").innerHTML = books.length ? books.map(b => `<article class="book-card">${cover(b)}<div class="card-body"><span class="category-pill">${esc(b.category)}</span><h3>${esc(b.title)}</h3><p class="author">por ${esc(b.author)}</p><p class="description">${esc(b.description)}</p><div class="card-footer"><span class="card-type">Lectura digital</span><button class="read-button" data-read="${esc(b.id)}">Leer ahora →</button></div></div></article>`).join("") : `<div class="empty-state">No encontramos libros con esa búsqueda. Prueba con otra palabra.</div>`;
}
async function loadBooks() {
  try {
    const data = await api("/api/books"); state.books = data.books || [];
    const cats = [...new Set(state.books.map(b => b.category))].sort((a,b) => a.localeCompare(b,"es"));
    $("#categorySelect").innerHTML = `<option>Todas</option>` + cats.map(c => `<option>${esc(c)}</option>`).join("");
    renderBooks();
  } catch (e) {
    $("#catalogCount").textContent = "No se pudo cargar";
    $("#bookGrid").innerHTML = `<div class="empty-state">No pudimos conectar con la biblioteca. Comprueba que la API y la base D1 estén configuradas. <br><br><small>${esc(e.message)}</small></div>`;
  }
}
function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === "register";
  $("#authTitle").textContent = register ? "Crea tu cuenta" : "Inicia sesión";
  $("#authIntro").textContent = register ? "Guarda tu progreso y continúa leyendo en otros dispositivos." : "Continúa donde te quedaste.";
  $("#nameField").classList.toggle("hidden", !register);
  $("#nameField input").required = register;
  $("#authForm [name=password]").autocomplete = register ? "new-password" : "current-password";
  $("#authSubmit").textContent = register ? "Crear cuenta gratis" : "Iniciar sesión";
  $("#switchLabel").textContent = register ? "¿Ya tienes cuenta?" : "¿Aún no tienes cuenta?";
  $("#switchAuth").textContent = register ? "Iniciar sesión" : "Crear cuenta";
  $("#authError").textContent = "";
}
function openAuth(mode = "login") {
  setAuthMode(mode);
  if (!$("#authDialog").open) $("#authDialog").showModal();
}
function renderAccount() {
  $("#accountButton").textContent = state.user ? `Hola, ${state.user.name.split(/\s+/)[0]}` : "Iniciar sesión";
  $("#heroAccount").textContent = state.user ? "Mi cuenta" : "Crear cuenta gratis";
  if (state.user) $("#syncStatus").textContent = `Sesión iniciada como ${state.user.name}. Tu progreso se sincroniza cuando hay conexión.`;
}
async function refreshUser() {
  try {
    const data = await api("/api/auth/me");
    state.user = data.user;
    if (state.user) {
      const p = await api("/api/progress");
      state.progress = Object.fromEntries((p.progress || []).map(x => [x.bookId, x]));
    }
  } catch { state.user = null; }
  renderAccount();
}
async function submitAuth(event) {
  event.preventDefault(); $("#authError").textContent = "";
  const form = new FormData($("#authForm"));
  const body = Object.fromEntries(form.entries());
  const path = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
  $("#authSubmit").disabled = true; $("#authSubmit").textContent = "Un momento…";
  try {
    const data = await api(path, { method: "POST", body: JSON.stringify(body) });
    state.user = data.user;
    const p = await api("/api/progress"); state.progress = Object.fromEntries((p.progress || []).map(x => [x.bookId, x]));
    $("#authDialog").close(); $("#authForm").reset(); renderAccount();
    toast(state.authMode === "register" ? "¡Cuenta creada! Ya puedes leer." : "Sesión iniciada.");
    if (state.currentBook) await syncProgressFromServer(state.currentBook.id);
  } catch (e) {
    $("#authError").textContent = e.message;
  } finally {
    $("#authSubmit").disabled = false; $("#authSubmit").textContent = state.authMode === "register" ? "Crear cuenta gratis" : "Iniciar sesión";
  }
}
async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  state.user = null; state.progress = {}; renderAccount(); toast("Has cerrado sesión.");
}
async function syncProgressFromServer(bookId) {
  if (!state.user) return;
  try {
    const p = await api("/api/progress");
    state.progress = Object.fromEntries((p.progress || []).map(x => [x.bookId, x]));
    const saved = state.progress[bookId];
    if (saved && state.content?.chapters?.length) {
      state.chapter = Math.max(0, Math.min(Number(saved.chapter) || 0, state.content.chapters.length - 1));
      renderChapter();
    }
    $("#syncStatus").textContent = "Progreso sincronizado con tu cuenta.";
  } catch (e) { $("#syncStatus").textContent = e.message; }
}
function queueProgressSave() {
  if (!state.user || !state.currentBook) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    const book = state.currentBook;
    const payload = { chapter: state.chapter, position: 0 };
    try {
      await api(`/api/progress/${encodeURIComponent(book.id)}`, { method: "PUT", body: JSON.stringify(payload) });
      state.progress[book.id] = { bookId: book.id, ...payload, updatedAt: new Date().toISOString() };
      $("#syncStatus").textContent = "Progreso guardado en tu cuenta.";
    } catch { $("#syncStatus").textContent = "No se pudo sincronizar. Comprueba tu conexión."; }
  }, 500);
}
async function openBook(id) {
  try {
    const data = await api(`/api/books/${encodeURIComponent(id)}`);
    state.currentBook = data.book; state.content = data.content; state.chapter = 0;
    $("#readerBookTitle").textContent = data.book.title; $("#readerAuthor").textContent = `por ${data.book.author}`;
    $("#readerCategory").textContent = data.book.category; $("#readerRights").textContent = data.book.rights_note;
    $("#readerDialog").showModal(); document.body.classList.add("reader-open");
    renderChapter();
    if (state.user) await syncProgressFromServer(id);
    else $("#syncStatus").textContent = "Inicia sesión para sincronizar tu progreso entre dispositivos.";
  } catch (e) { toast(e.message); }
}
function renderChapter() {
  if (!state.content?.chapters?.length) return;
  const chapters = state.content.chapters;
  state.chapter = Math.max(0, Math.min(state.chapter, chapters.length - 1));
  const chapter = chapters[state.chapter];
  $("#chapterTitle").textContent = chapter.title;
  $("#readerText").innerHTML = (chapter.paragraphs || []).map(p => `<p>${esc(p)}</p>`).join("");
  $("#readerText").style.fontSize = `${state.fontSize}px`;
  $("#chapterList").innerHTML = chapters.map((c,i) => `<button class="chapter-item ${i === state.chapter ? "active" : ""}" data-chapter="${i}">${i+1}. ${esc(c.title)}</button>`).join("");
  $("#prevChapter").disabled = state.chapter === 0;
  $("#nextChapter").disabled = state.chapter >= chapters.length - 1;
  $("#nextChapter").textContent = state.chapter >= chapters.length - 1 ? "Fin del libro" : "Siguiente capítulo →";
  queueProgressSave();
}
function stopSpeech() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  state.utterance = null; $("#listenButton").textContent = "▶ Escuchar capítulo";
}
function toggleSpeech() {
  if (!("speechSynthesis" in window)) { toast("Este navegador no ofrece narración de texto."); return; }
  if (window.speechSynthesis.speaking) { stopSpeech(); return; }
  const chapter = state.content?.chapters?.[state.chapter];
  if (!chapter) return;
  const utterance = new SpeechSynthesisUtterance(`${chapter.title}. ${(chapter.paragraphs || []).join(". ")}`);
  utterance.lang = "es-MX"; utterance.rate = 0.92;
  utterance.onend = () => { state.utterance = null; $("#listenButton").textContent = "▶ Escuchar capítulo"; };
  utterance.onerror = () => { state.utterance = null; $("#listenButton").textContent = "▶ Escuchar capítulo"; toast("No se pudo reproducir la voz en este dispositivo."); };
  state.utterance = utterance; window.speechSynthesis.speak(utterance);
  $("#listenButton").textContent = "Ⅱ Detener narración";
}
$("#searchInput").addEventListener("input", renderBooks);
$("#categorySelect").addEventListener("change", renderBooks);
$("#bookGrid").addEventListener("click", e => { const btn = e.target.closest("[data-read]"); if (btn) openBook(btn.dataset.read); });
$("#accountButton").addEventListener("click", () => state.user ? (confirm("¿Quieres cerrar tu sesión?") && logout()) : openAuth("login"));
$("#heroAccount").addEventListener("click", () => state.user ? toast("Tu progreso está asociado a tu cuenta.") : openAuth("register"));
$("#switchAuth").addEventListener("click", () => setAuthMode(state.authMode === "login" ? "register" : "login"));
$("#authForm").addEventListener("submit", submitAuth);
$("#closeReader").addEventListener("click", () => { stopSpeech(); $("#readerDialog").close(); document.body.classList.remove("reader-open"); });
$("#readerDialog").addEventListener("close", () => { stopSpeech(); document.body.classList.remove("reader-open"); });
$("#chapterList").addEventListener("click", e => { const btn = e.target.closest("[data-chapter]"); if (btn) { stopSpeech(); state.chapter = Number(btn.dataset.chapter); renderChapter(); } });
$("#prevChapter").addEventListener("click", () => { if (state.chapter > 0) { stopSpeech(); state.chapter--; renderChapter(); } });
$("#nextChapter").addEventListener("click", () => { if (state.chapter < state.content.chapters.length - 1) { stopSpeech(); state.chapter++; renderChapter(); } });
$("#fontDown").addEventListener("click", () => { state.fontSize = Math.max(15, state.fontSize - 1); $("#readerText").style.fontSize = `${state.fontSize}px`; });
$("#fontUp").addEventListener("click", () => { state.fontSize = Math.min(28, state.fontSize + 1); $("#readerText").style.fontSize = `${state.fontSize}px`; });
$("#themeToggle").addEventListener("click", () => $("#readerDialog").classList.toggle("dark-reader"));
$("#listenButton").addEventListener("click", toggleSpeech);
$("#year").textContent = new Date().getFullYear();

(async function init() {
  await Promise.all([loadBooks(), refreshUser()]);
})();
