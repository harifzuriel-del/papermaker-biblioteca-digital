const $ = (s) => document.querySelector(s);

const state = {
  books: [],
  privateBooks: [],
  privateProgress: {},
  user: null,
  authMode: "login",
  currentBook: null,
  content: null,
  chapter: 0,
  fontSize: 19,
  progress: {},
  saveTimer: null,
  utterance: null,
  isRestoringProgress: false
};

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });

  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || data.message || `Error ${response.status}`);
  return data;
}

function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3000);
}

function cover(book) {
  return `<div class="cover" style="background:${esc(book.cover_color || "#e9e4d8")}">
    <div class="cover-mark"><span>PM / ${esc((book.category || "").toUpperCase())}</span>
    <b>${esc(book.title)}</b><small>PAPERMAKER · BIBLIOTECA</small></div>
  </div>`;
}

/* CATÁLOGO PÚBLICO */
function renderBooks() {
  const query = $("#searchInput").value.trim().toLocaleLowerCase("es-MX");
  const category = $("#categorySelect").value;

  const books = state.books.filter(b =>
    (!query || `${b.title} ${b.author} ${b.description || ""} ${b.category || ""}`
      .toLocaleLowerCase("es-MX").includes(query)) &&
    (category === "Todas" || b.category === category)
  );

  $("#catalogCount").textContent = `${books.length} ${books.length === 1 ? "libro" : "libros"}`;
  $("#bookGrid").innerHTML = books.length ? books.map(b => `
    <article class="book-card">
      ${cover(b)}
      <div class="card-body">
        <span class="category-pill">${esc(b.category)}</span>
        <h3>${esc(b.title)}</h3>
        <p class="author">por ${esc(b.author)}</p>
        <p class="description">${esc(b.description || "")}</p>
        <div class="card-footer">
          <span class="card-type">Lectura digital</span>
          <button class="read-button" data-read="${esc(b.id)}">Leer ahora →</button>
        </div>
      </div>
    </article>`).join("") :
    `<div class="empty-state">No encontramos libros con esa búsqueda. Prueba con otra palabra.</div>`;
}

async function loadBooks() {
  try {
    const data = await api("/api/books");
    state.books = data.books || [];
    const cats = [...new Set(state.books.map(b => b.category).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "es"));
    $("#categorySelect").innerHTML =
      `<option>Todas</option>` + cats.map(c => `<option>${esc(c)}</option>`).join("");
    renderBooks();
  } catch (e) {
    $("#catalogCount").textContent = "No se pudo cargar";
    $("#bookGrid").innerHTML = `<div class="empty-state">
      No pudimos conectar con la biblioteca. Comprueba que la API y la base D1 estén configuradas.
      <br><br><small>${esc(e.message)}</small></div>`;
  }
}

/* BIBLIOTECA PRIVADA */
async function loadPrivateBooks() {
  const section = $("#mis-libros");
  const grid = $("#privateBookGrid");
  if (!section || !grid) return;

  if (!state.user) {
    section.classList.add("hidden");
    state.privateBooks = [];
    state.privateProgress = {};
    grid.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  grid.innerHTML = '<div class="loading">Cargando tus libros…</div>';

  try {
    const data = await api("/api/private-books");
    state.privateBooks = data.books || [];
    renderPrivateBooks();
  } catch (error) {
    grid.innerHTML = `<div class="empty-state">No se pudieron cargar tus libros privados.
      <br><br>${esc(error.message)}</div>`;
  }
}

function renderPrivateBooks() {
  const grid = $("#privateBookGrid");
  if (!grid) return;
  if (!state.user) { grid.innerHTML = ""; return; }

  if (!state.privateBooks.length) {
    grid.innerHTML = `<div class="empty-state">Todavía no tienes libros privados.
      <br><br>Importa tu primer archivo TXT o PDF para comenzar.</div>`;
    return;
  }

  grid.innerHTML = state.privateBooks.map(book => `
    <article class="book-card">
      <div class="cover"><div class="cover-mark">
        <span>PAPERMAKER · PRIVADO</span><b>${esc(book.title)}</b><small>${esc(book.author)}</small>
      </div></div>
      <div class="card-body">
        <span class="category-pill">Mi biblioteca</span><h3>${esc(book.title)}</h3>
        <p class="author">por ${esc(book.author)}</p>
        <div class="card-footer">
          <button class="read-button" data-private-read="${esc(book.id)}">Leer ahora →</button>
          <button class="button button-outline" data-private-delete="${esc(book.id)}"
            aria-label="Eliminar ${esc(book.title)}">Eliminar</button>
        </div>
      </div>
    </article>`).join("");
}

function splitTextIntoChapters(text) {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").trim();
  if (!normalized) throw new Error("El archivo no contiene texto legible.");

  const lines = normalized.split("\n");
  const chapterPattern = /^\s*(?:cap[ií]tulo|chapter)\s+(?:\d+|[ivxlcdm]+)\b.*$/i;
  const chapters = [];
  let currentTitle = "Texto inicial";
  let paragraphs = [];

  function saveChapter() {
    const cleaned = paragraphs.join("\n")
      .split(/\n\s*\n+/)
      .map(p => p.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean);
    if (cleaned.length) chapters.push({ title: currentTitle, paragraphs: cleaned });
    paragraphs = [];
  }

  for (const line of lines) {
    if (chapterPattern.test(line)) {
      if (paragraphs.length) saveChapter();
      currentTitle = line.trim();
    } else {
      paragraphs.push(line);
    }
  }
  saveChapter();

  if (!chapters.length) chapters.push({ title: "Capítulo 1", paragraphs: [normalized] });
  if (chapters.length > 1000) throw new Error("El archivo contiene más de 1,000 capítulos.");

  const total = chapters.reduce((sum, ch) =>
    sum + ch.paragraphs.reduce((n, p) => n + p.length, 0), 0);
  if (total > 1000000) throw new Error("El libro supera el límite de un millón de caracteres.");
  return { chapters };
}

async function extractImportedText(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "txt") return await file.text();
  if (extension !== "pdf") throw new Error("Selecciona un archivo TXT o PDF.");
  if (!window.pdfjsLib) throw new Error("No se pudo cargar PDF.js. Recarga la página e inténtalo de nuevo.");

  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const items = content.items.filter(x => typeof x.str === "string")
      .map(x => ({ text: x.str, y: x.transform ? x.transform[5] : 0 }));

    let pageText = "";
    let previousY = null;
    for (const item of items) {
      if (previousY !== null && Math.abs(item.y - previousY) > 4) pageText += "\n";
      else if (pageText && !pageText.endsWith("\n")) pageText += " ";
      pageText += item.text;
      previousY = item.y;
    }
    pages.push(pageText);
  }

  const text = pages.join("\n\n");
  if (!text.trim()) throw new Error("Este PDF no contiene texto extraíble. Si es un escaneo, necesitará OCR.");
  return text;
}

async function importPrivateBook(event) {
  event.preventDefault();
  const errorEl = $("#importBookError");
  const button = $("#savePrivateBookButton");
  errorEl.textContent = "";

  if (!state.user) {
    $("#importBookDialog").close();
    openAuth("login");
    return;
  }

  const title = $("#privateBookTitle").value.trim();
  const author = $("#privateBookAuthor").value.trim();
  const file = $("#privateBookFile").files[0];
  if (!title || !author || !file) {
    errorEl.textContent = "Completa el título, el autor y selecciona un archivo.";
    return;
  }

  button.disabled = true;
  button.textContent = "Procesando archivo…";
    try {
    const content = splitTextIntoChapters(await extractImportedText(file));
    button.textContent = "Guardando libro…";
    const result = await api("/api/private-books", {
      method: "POST",
      body: JSON.stringify({ title, author, content })
    });
    state.privateBooks.unshift(result.book);
    renderPrivateBooks();
    $("#importBookForm").reset();
    $("#importBookDialog").close();
    toast("Libro importado correctamente.");
  } catch (error) {
    console.error("Error al importar el libro:", error);
    errorEl.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Importar a mi biblioteca";
  }
}

function openImportDialog() {
  if (!state.user) {
    openAuth("login");
    toast("Inicia sesión para importar libros privados.");
    return;
  }
  $("#importBookError").textContent = "";
  $("#importBookDialog").showModal();
}

async function deletePrivateBook(id) {
  const book = state.privateBooks.find(b => String(b.id) === String(id));
  if (!book || !confirm(`¿Eliminar "${book.title}" de tus libros privados?`)) return;

  try {
    await api(`/api/private-books/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.privateBooks = state.privateBooks.filter(b => String(b.id) !== String(id));

    if (state.currentBook?.isPrivate && String(state.currentBook.id) === String(id)) {
      clearTimeout(state.saveTimer);
      stopSpeech();
      if ($("#readerDialog").open) $("#readerDialog").close();
      state.currentBook = null;
      state.content = null;
    }

    renderPrivateBooks();
    toast("Libro privado eliminado.");
  } catch (error) {
    toast(error.message);
  }
}

/* AUTENTICACIÓN */
function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === "register";
  $("#authTitle").textContent = register ? "Crea tu cuenta" : "Inicia sesión";
  $("#authIntro").textContent = register
    ? "Guarda tu progreso y continúa leyendo en otros dispositivos."
    : "Continúa donde te quedaste.";
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
  $("#accountButton").textContent = state.user
    ? `Hola, ${state.user.name.split(/\s+/)[0]}`
    : "Iniciar sesión";
  $("#heroAccount").textContent = state.user ? "Mi cuenta" : "Crear cuenta gratis";

  if (state.user) {
    $("#syncStatus").textContent =
      `Sesión iniciada como ${state.user.name}. Tu progreso se sincroniza cuando hay conexión.`;
  }
}

async function refreshUser() {
  try {
    const data = await api("/api/auth/me");
    state.user = data.user;
    if (state.user) {
      const p = await api("/api/progress");
      state.progress = Object.fromEntries((p.progress || []).map(x => [String(x.bookId), x]));
    }
  } catch {
    state.user = null;
    state.progress = {};
  }

  renderAccount();
  await loadPrivateBooks();
}

async function submitAuth(event) {
  event.preventDefault();
  $("#authError").textContent = "";

  const body = Object.fromEntries(new FormData($("#authForm")).entries());
  const mode = state.authMode;
  const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";

  $("#authSubmit").disabled = true;
  $("#authSubmit").textContent = "Un momento…";

  try {
    const data = await api(path, { method: "POST", body: JSON.stringify(body) });
    state.user = data.user;

    try {
      const p = await api("/api/progress");
      state.progress = Object.fromEntries((p.progress || []).map(x => [String(x.bookId), x]));
    } catch (e) {
      console.error("Error al cargar el progreso:", e);
      toast("Sesión iniciada, pero no se pudo cargar el progreso público.");
    }

    $("#authDialog").close();
    $("#authForm").reset();
    renderAccount();
    await loadPrivateBooks();
    toast(mode === "register" ? "¡Cuenta creada! Ya puedes leer." : "Sesión iniciada.");

    if (state.currentBook) {
      if (state.currentBook.isPrivate) await syncPrivateProgressFromServer(state.currentBook.id);
      else await syncProgressFromServer(state.currentBook.id);
    }
  } catch (e) {
    console.error("Error de autenticación:", e);
    $("#authError").textContent = e.message;
  } finally {
    $("#authSubmit").disabled = false;
    $("#authSubmit").textContent = mode === "register" ? "Crear cuenta gratis" : "Iniciar sesión";
  }
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}

  clearTimeout(state.saveTimer);
  state.user = null;
  state.progress = {};
  state.privateProgress = {};
  state.privateBooks = [];

  if (state.currentBook?.isPrivate) {
    stopSpeech();
    if ($("#readerDialog").open) $("#readerDialog").close();
    state.currentBook = null;
    state.content = null;
  }

  renderAccount();
  await loadPrivateBooks();
  toast("Has cerrado sesión.");
}

/* PROGRESO DE LECTURA */
function getReaderScrollContainer() {
  return $("#readerDialog");
}

function getReadingPosition() {
  const container = getReaderScrollContainer();
  return container ? Math.max(0, Math.round(container.scrollTop)) : 0;
}

function restoreReadingPosition(position) {
  const container = getReaderScrollContainer();
  if (container) container.scrollTop = Math.max(0, Number(position) || 0);
}

function queueProgressSave() {
  if (!state.user || !state.currentBook || state.isRestoringProgress) return;
  clearTimeout(state.saveTimer);

  state.saveTimer = setTimeout(async () => {
    const book = state.currentBook;
    if (!book || !state.user) return;

    const payload = { chapter: state.chapter, position: getReadingPosition() };
    const isPrivate = book.isPrivate === true;
    const endpoint = isPrivate
      ? `/api/private-progress/${encodeURIComponent(book.id)}`
      : `/api/progress/${encodeURIComponent(book.id)}`;

    try {
      await api(endpoint, { method: "PUT", body: JSON.stringify(payload) });
      const entry = { bookId: book.id, ...payload, updatedAt: new Date().toISOString() };
      if (isPrivate) state.privateProgress[String(book.id)] = entry;
      else state.progress[String(book.id)] = entry;
      $("#syncStatus").textContent = "Progreso guardado en tu cuenta.";
    } catch (error) {
      console.error("Error al guardar el progreso:", error);
      $("#syncStatus").textContent = "No se pudo sincronizar. Comprueba tu conexión.";
    }
  }, 700);
}

async function syncPrivateProgressFromServer(bookId) {
  if (!state.user) return;
  state.isRestoringProgress = true;
  clearTimeout(state.saveTimer);

  try {
    const data = await api("/api/private-progress");
    state.privateProgress = Object.fromEntries(
      (data.progress || []).map(item => [String(item.bookId), item])
    );
    const saved = state.privateProgress[String(bookId)];

    if (saved && String(state.currentBook?.id) === String(bookId) &&
        state.currentBook?.isPrivate && state.content?.chapters?.length) {
      state.chapter = Math.max(0, Math.min(Number(saved.chapter) || 0, state.content.chapters.length - 1));
      renderChapter();
      restoreReadingPosition(saved.position);
    }
    $("#syncStatus").textContent = "Progreso del libro privado sincronizado.";
  } catch (error) {
    console.error("Error al sincronizar el progreso privado:", error);
    $("#syncStatus").textContent = "No se pudo sincronizar el progreso privado.";
  } finally {
    state.isRestoringProgress = false;
    if (state.currentBook?.isPrivate && String(state.currentBook.id) === String(bookId) && state.user) {
      queueProgressSave();
    }
  }
}

async function syncProgressFromServer(bookId) {
  if (!state.user) return;
  state.isRestoringProgress = true;
  clearTimeout(state.saveTimer);

  try {
    const data = await api("/api/progress");
    state.progress = Object.fromEntries((data.progress || []).map(x => [String(x.bookId), x]));
    const saved = state.progress[String(bookId)];
        if (saved && String(state.currentBook?.id) === String(bookId) &&
        !state.currentBook?.isPrivate && state.content?.chapters?.length) {
      state.chapter = Math.max(0, Math.min(Number(saved.chapter) || 0, state.content.chapters.length - 1));
      renderChapter();
      restoreReadingPosition(saved.position);
    }
    $("#syncStatus").textContent = "Progreso sincronizado con tu cuenta.";
  } catch (e) {
    console.error("Error al sincronizar el progreso:", e);
    $("#syncStatus").textContent = "No se pudo sincronizar tu progreso.";
  } finally {
    state.isRestoringProgress = false;
    if (!state.currentBook?.isPrivate && String(state.currentBook?.id) === String(bookId) && state.user) {
      queueProgressSave();
    }
  }
}

/* LECTOR */
async function openBook(id) {
  try {
    const data = await api(`/api/books/${encodeURIComponent(id)}`);
    clearTimeout(state.saveTimer);
    stopSpeech();

    state.currentBook = { ...data.book, isPrivate: false };
    state.content = data.content;
    state.chapter = 0;

    $("#readerBookTitle").textContent = data.book.title;
    $("#readerAuthor").textContent = `por ${data.book.author}`;
    $("#readerCategory").textContent = data.book.category;
    $("#readerRights").textContent = data.book.rights_note;

    $("#readerDialog").showModal();
    document.body.classList.add("reader-open");
    renderChapter();

    if (state.user) await syncProgressFromServer(id);
    else $("#syncStatus").textContent = "Inicia sesión para sincronizar tu progreso entre dispositivos.";
  } catch (e) {
    console.error("Error al abrir el libro:", e);
    toast(e.message);
  }
}

async function openPrivateBook(id) {
  try {
    const data = await api(`/api/private-books/${encodeURIComponent(id)}`);
    clearTimeout(state.saveTimer);
    stopSpeech();

    state.currentBook = {
      ...data.book,
      category: "Mi biblioteca privada",
      rights_note: "Libro privado de tu cuenta.",
      isPrivate: true
    };
    state.content = data.content;
    state.chapter = 0;

    $("#readerBookTitle").textContent = data.book.title;
    $("#readerAuthor").textContent = `por ${data.book.author}`;
    $("#readerCategory").textContent = "Mi biblioteca privada";
    $("#readerRights").textContent = "Libro privado de tu cuenta.";

    $("#readerDialog").showModal();
    document.body.classList.add("reader-open");
    renderChapter();

    if (state.user) await syncPrivateProgressFromServer(id);
    else $("#syncStatus").textContent = "Inicia sesión para guardar tu progreso.";
  } catch (error) {
    console.error("Error al abrir el libro privado:", error);
    toast(error.message);
  }
}

function renderChapter() {
  if (!state.content?.chapters?.length) return;

  const chapters = state.content.chapters;
  state.chapter = Math.max(0, Math.min(state.chapter, chapters.length - 1));
  const chapter = chapters[state.chapter];

  $("#chapterTitle").textContent = chapter.title;
  $("#readerText").innerHTML = (chapter.paragraphs || []).map(p => `<p>${esc(p)}</p>`).join("");
  $("#readerText").style.fontSize = `${state.fontSize}px`;

  $("#chapterList").innerHTML = chapters.map((c, i) => `
    <button class="chapter-item ${i === state.chapter ? "active" : ""}" data-chapter="${i}">
      ${i + 1}. ${esc(c.title)}
    </button>`).join("");

  $("#prevChapter").disabled = state.chapter === 0;
  $("#nextChapter").disabled = state.chapter >= chapters.length - 1;
  $("#nextChapter").textContent = state.chapter >= chapters.length - 1
    ? "Fin del libro" : "Siguiente capítulo →";

  const container = getReaderScrollContainer();
  if (container) container.scrollTop = 0;
  queueProgressSave();
}

/* VOZ */
function stopSpeech() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  state.utterance = null;
  const button = $("#listenButton");
  if (button) button.textContent = "▶ Escuchar capítulo";
}

function toggleSpeech() {
  if (!("speechSynthesis" in window)) {
    toast("Este navegador no ofrece narración de texto.");
    return;
  }
  if (window.speechSynthesis.speaking) {
    stopSpeech();
    return;
  }

  const chapter = state.content?.chapters?.[state.chapter];
  if (!chapter) return;

  const utterance = new SpeechSynthesisUtterance(
    `${chapter.title}. ${(chapter.paragraphs || []).join(". ")}`
  );
  utterance.lang = "es-MX";
  utterance.rate = 0.92;
  utterance.onend = () => {
    state.utterance = null;
    $("#listenButton").textContent = "▶ Escuchar capítulo";
  };
  utterance.onerror = () => {
    state.utterance = null;
    $("#listenButton").textContent = "▶ Escuchar capítulo";
    toast("No se pudo reproducir la voz en este dispositivo.");
  };

  state.utterance = utterance;
  window.speechSynthesis.speak(utterance);
  $("#listenButton").textContent = "Ⅱ Detener narración";
}

/* EVENTOS */
$("#searchInput").addEventListener("input", renderBooks);
$("#categorySelect").addEventListener("change", renderBooks);

$("#bookGrid").addEventListener("click", e => {
  const btn = e.target.closest("[data-read]");
  if (btn) openBook(btn.dataset.read);
});

$("#accountButton").addEventListener("click", () => {
  if (state.user) {
    if (confirm("¿Quieres cerrar tu sesión?")) logout();
  } else {
    openAuth("login");
  }
});

$("#heroAccount").addEventListener("click", () => {
  if (state.user) toast("Tu progreso está asociado a tu cuenta.");
  else openAuth("register");
});

$("#switchAuth").addEventListener("click", () => {
  setAuthMode(state.authMode === "login" ? "register" : "login");
});

$("#authForm").addEventListener("submit", submitAuth);

const importBookButton = $("#importBookButton");
if (importBookButton) {
  importBookButton.addEventListener("click", openImportDialog);
}

const importBookForm = $("#importBookForm");
if (importBookForm) {
  importBookForm.addEventListener("submit", importPrivateBook);
}

const privateBookGrid = $("#privateBookGrid");

if (privateBookGrid) {
  privateBookGrid.addEventListener("click", e => {
    const readButton = e.target.closest("[data-private-read]");
    const deleteButton = e.target.closest("[data-private-delete]");

    if (readButton) {
      openPrivateBook(readButton.dataset.privateRead);
    }

    if (deleteButton) {
      deletePrivateBook(deleteButton.dataset.privateDelete);
    }
  });
};

$("#closeReader").addEventListener("click", () => {
  stopSpeech();
  $("#readerDialog").close();
  document.body.classList.remove("reader-open");
});

$("#readerDialog").addEventListener("close", () => {
  stopSpeech();
  document.body.classList.remove("reader-open");
});

$("#readerDialog").addEventListener("scroll", () => queueProgressSave(), { passive: true });

$("#chapterList").addEventListener("click", e => {
  const btn = e.target.closest("[data-chapter]");
  if (btn) {
    stopSpeech();
    state.chapter = Number(btn.dataset.chapter);
    renderChapter();
  }
});

$("#prevChapter").addEventListener("click", () => {
  if (state.chapter > 0) {
    stopSpeech();
    state.chapter--;
    renderChapter();
  }
});

$("#nextChapter").addEventListener("click", () => {
  if (state.content && state.chapter < state.content.chapters.length - 1) {
    stopSpeech();
    state.chapter++;
    renderChapter();
  }
});

$("#fontDown").addEventListener("click", () => {
  state.fontSize = Math.max(15, state.fontSize - 1);
  $("#readerText").style.fontSize = `${state.fontSize}px`;
});

$("#fontUp").addEventListener("click", () => {
  state.fontSize = Math.min(28, state.fontSize + 1);
  $("#readerText").style.fontSize = `${state.fontSize}px`;
});

$("#themeToggle").addEventListener("click", () => $("#readerDialog").classList.toggle("dark-reader"));
$("#listenButton").addEventListener("click", toggleSpeech);
$("#year").textContent = new Date().getFullYear();

(async function init() {
  await Promise.all([loadBooks(), refreshUser()]);
})();
