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
  isRestoringProgress: false,
  translatedChapter: null,
  showingTranslation: false
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
    console.error("Error al cargar libros privados:", error);
    grid.innerHTML = `<div class="empty-state">No se pudieron cargar tus libros privados.<br><small>${esc(error.message)}</small></div>`;
  }
}

function renderPrivateBooks() {
  const grid = $("#privateBookGrid");
  if (!grid) return;

  grid.innerHTML = state.privateBooks.length
    ? state.privateBooks.map(book => `
      <article class="book-card">
        ${cover({
          ...book,
          category: "Mi biblioteca privada"
        })}
        <div class="card-body">
          <span class="category-pill">Mi biblioteca privada</span>
          <h3>${esc(book.title)}</h3>
          <p class="author">por ${esc(book.author || "Autor desconocido")}</p>
          <div class="card-footer">
            <button class="read-button" data-private-read="${esc(book.id)}">Leer ahora →</button>
            <button class="delete-button" data-private-delete="${esc(book.id)}">Eliminar</button>
          </div>
        </div>
      </article>
    `).join("")
    : '<div class="empty-state">Todavía no tienes libros privados.</div>';
}

async function deletePrivateBook(id) {
  if (!confirm("¿Seguro que deseas eliminar este libro de tu biblioteca privada?")) return;

  try {
    await api(`/api/private-books/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    state.privateBooks = state.privateBooks.filter(book => String(book.id) !== String(id));
    renderPrivateBooks();
    toast("Libro eliminado.");
  } catch (error) {
    console.error("Error al eliminar el libro:", error);
    toast(error.message || "No se pudo eliminar el libro.");
  }
}

/* AUTENTICACIÓN */
function setAuthMode(mode) {
  state.authMode = mode;

  const title = $("#authTitle");
  const submit = $("#authSubmit");
  const nameField = $("#nameField");
  const switchText = $("#authSwitchText");
  const switchButton = $("#authSwitch");

  if (title) title.textContent = mode === "register" ? "Crear cuenta" : "Iniciar sesión";
  if (submit) submit.textContent = mode === "register" ? "Crear cuenta" : "Entrar";
  if (nameField) nameField.classList.toggle("hidden", mode !== "register");
  if (switchText) switchText.textContent = mode === "register"
    ? "¿Ya tienes una cuenta?"
    : "¿Todavía no tienes cuenta?";
  if (switchButton) switchButton.textContent = mode === "register"
    ? "Inicia sesión"
    : "Regístrate";
}

async function refreshUser() {
  try {
    const data = await api("/api/auth/me");
    state.user = data.user || null;
  } catch {
    state.user = null;
  }

  renderAuth();
  await loadPrivateBooks();
}

function renderAuth() {
  const loggedOut = $("#loggedOut");
  const loggedIn = $("#loggedIn");
  const userEmail = $("#userEmail");

  if (loggedOut) loggedOut.classList.toggle("hidden", !!state.user);
  if (loggedIn) loggedIn.classList.toggle("hidden", !state.user);
  if (userEmail && state.user) userEmail.textContent = state.user.email;
}

async function submitAuth(event) {
  event.preventDefault();

  const email = $("#emailInput")?.value.trim();
  const password = $("#passwordInput")?.value;
  const name = $("#nameInput")?.value.trim();

  try {
    const endpoint = state.authMode === "register"
      ? "/api/auth/register"
      : "/api/auth/login";

    const body = state.authMode === "register"
      ? { email, password, name }
      : { email, password };

    await api(endpoint, {
      method: "POST",
      body: JSON.stringify(body)
    });

    toast(state.authMode === "register"
      ? "Cuenta creada correctamente."
      : "Sesión iniciada.");

    if ($("#authForm")) $("#authForm").reset();
    await refreshUser();
  } catch (error) {
    console.error("Error de autenticación:", error);
    toast(error.message || "No se pudo completar la operación.");
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
    state.user = null;
    state.privateBooks = [];
    state.privateProgress = {};
    renderAuth();
    await loadPrivateBooks();
    toast("Sesión cerrada.");
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
    toast(error.message || "No se pudo cerrar la sesión.");
  }
}

/* LECTURA Y PROGRESO */
function getReaderScrollContainer() {
  return $("#readerText")?.parentElement || $("#readerDialog");
}

function getReadingPosition() {
  const container = getReaderScrollContainer();
  return container ? container.scrollTop : 0;
}

function restoreReadingPosition(position) {
  const container = getReaderScrollContainer();
  if (container) container.scrollTop = Number(position) || 0;
}

function queueProgressSave() {
  if (state.isRestoringProgress || !state.currentBook) return;

  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    saveProgress();
  }, 800);
}

async function saveProgress() {
  if (!state.currentBook) return;

  const bookId = String(state.currentBook.id);
  const progressData = {
    chapter: state.chapter,
    position: getReadingPosition()
  };

  if (state.currentBook.isPrivate) {
    state.privateProgress[bookId] = progressData;
  } else {
    state.progress[bookId] = progressData;
  }

  if (!state.user) return;

  try {
    const endpoint = state.currentBook.isPrivate
      ? "/api/private-progress"
      : "/api/progress";

    await api(endpoint, {
      method: "POST",
      body: JSON.stringify({
        bookId,
        ...progressData
      })
    });

    const status = $("#syncStatus");
    if (status) status.textContent = "Progreso sincronizado.";
  } catch (error) {
    console.error("Error al guardar el progreso:", error);
    const status = $("#syncStatus");
    if (status) status.textContent = "No se pudo guardar el progreso.";
  }
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

    if (
      saved &&
      String(state.currentBook?.id) === String(bookId) &&
      state.currentBook?.isPrivate &&
      state.content?.chapters?.length
    ) {
      state.chapter = Math.max(
        0,
        Math.min(Number(saved.chapter) || 0, state.content.chapters.length - 1)
      );

      renderChapter();
      restoreReadingPosition(saved.position);
    }

    const status = $("#syncStatus");
    if (status) status.textContent = "Progreso del libro privado sincronizado.";
  } catch (error) {
    console.error("Error al sincronizar el progreso privado:", error);
    const status = $("#syncStatus");
    if (status) status.textContent = "No se pudo sincronizar el progreso privado.";
  } finally {
    state.isRestoringProgress = false;

    if (
      state.currentBook?.isPrivate &&
      String(state.currentBook.id) === String(bookId) &&
      state.user
    ) {
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
    state.progress = Object.fromEntries(
      (data.progress || []).map(item => [String(item.bookId), item])
    );

    const saved = state.progress[String(bookId)];

    if (
      saved &&
      String(state.currentBook?.id) === String(bookId) &&
      !state.currentBook?.isPrivate &&
      state.content?.chapters?.length
    ) {
      state.chapter = Math.max(
        0,
        Math.min(Number(saved.chapter) || 0, state.content.chapters.length - 1)
      );

      renderChapter();
      restoreReadingPosition(saved.position);
    }

    const status = $("#syncStatus");
    if (status) status.textContent = "Progreso sincronizado con tu cuenta.";
  } catch (error) {
    console.error("Error al sincronizar el progreso:", error);
    const status = $("#syncStatus");
    if (status) status.textContent = "No se pudo sincronizar tu progreso.";
  } finally {
    state.isRestoringProgress = false;

    if (
      !state.currentBook?.isPrivate &&
      String(state.currentBook?.id) === String(bookId) &&
      state.user
    ) {
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
    state.translatedChapter = null;
    state.showingTranslation = false;

    $("#readerBookTitle").textContent = data.book.title;
    $("#readerAuthor").textContent = `por ${data.book.author}`;
    $("#readerCategory").textContent = data.book.category;
    $("#readerRights").textContent = data.book.rights_note;

    $("#readerDialog").showModal();
    document.body.classList.add("reader-open");

    renderChapter();

    if (state.user) {
      await syncProgressFromServer(id);
    } else {
      $("#syncStatus").textContent = "Inicia sesión para sincronizar tu progreso entre dispositivos.";
    }
  } catch (error) {
    console.error("Error al abrir el libro:", error);
    toast(error.message);
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
    state.translatedChapter = null;
    state.showingTranslation = false;

    $("#readerBookTitle").textContent = data.book.title;
    $("#readerAuthor").textContent = `por ${data.book.author}`;
    $("#readerCategory").textContent = "Mi biblioteca privada";
    $("#readerRights").textContent = "Libro privado de tu cuenta.";

    $("#readerDialog").showModal();
    document.body.classList.add("reader-open");

    renderChapter();

    if (state.user) {
      await syncPrivateProgressFromServer(id);
    } else {
      $("#syncStatus").textContent = "Inicia sesión para guardar tu progreso.";
    }
  } catch (error) {
    console.error("Error al abrir el libro privado:", error);
    toast(error.message);
  }
}

/* TRADUCCIÓN DE CAPÍTULOS */
function canTranslateCurrentBook() {
  return (
    state.currentBook?.isPrivate === true &&
    state.currentBook?.language === "en"
  );
}

async function translateCurrentChapter() {
  const button = $("#translateButton");

  if (!canTranslateCurrentBook()) {
    toast("La traducción está disponible para libros privados en inglés.");
    return;
  }

  // Si ya tenemos la traducción de este capítulo, alternamos
  // entre el original y la traducción sin llamar otra vez al servidor.
  if (
    state.translatedChapter?.chapter === state.chapter &&
    state.translatedChapter?.bookId === String(state.currentBook.id)
  ) {
    toggleChapterTranslation();
    return;
  }

  const chapterToTranslate = state.chapter;
  const bookId = String(state.currentBook.id);

  if (button) {
    button.disabled = true;
    button.textContent = "Traduciendo…";
  }

  try {
    stopSpeech();

    const result = await api(
      `/api/private-books/${encodeURIComponent(bookId)}/translate`,
      {
        method: "POST",
        body: JSON.stringify({
          chapter: chapterToTranslate
        })
      }
    );

    // No aplicar la respuesta si el usuario cambió de libro o capítulo.
    if (
      String(state.currentBook?.id) !== bookId ||
      state.chapter !== chapterToTranslate
    ) {
      return;
    }

    if (!result?.ok || !Array.isArray(result.paragraphs)) {
      throw new Error("El servidor no devolvió una traducción válida.");
    }

    state.translatedChapter = {
      bookId,
      chapter: chapterToTranslate,
      title: result.title || state.content.chapters[chapterToTranslate].title,
      paragraphs: result.paragraphs
    };

    state.showingTranslation = true;

    renderChapter();
    toast("Capítulo traducido al español.");
  } catch (error) {
    console.error("Error al traducir el capítulo:", error);
    toast(error.message || "No se pudo traducir el capítulo.");
  } finally {
    if (button) button.disabled = false;
    updateTranslationButton();
  }
}

function updateTranslationButton() {
  const button = $("#translateButton");
  if (!button) return;

  const available = canTranslateCurrentBook();

  button.hidden = !available;

  if (!available) return;

  button.textContent = state.showingTranslation
    ? "Ver original"
    : "🌐 Traducir capítulo";
}

function toggleChapterTranslation() {
  if (
    !state.translatedChapter ||
    state.translatedChapter.chapter !== state.chapter ||
    state.translatedChapter.bookId !== String(state.currentBook?.id)
  ) {
    return;
  }

  stopSpeech();
  state.showingTranslation = !state.showingTranslation;
  renderChapter();
}

function renderChapter() {
  if (!state.content?.chapters?.length) return;

  const chapters = state.content.chapters;

  state.chapter = Math.max(
    0,
    Math.min(state.chapter, chapters.length - 1)
  );

  const originalChapter = chapters[state.chapter];

  const translationIsCurrent =
    state.showingTranslation &&
    state.translatedChapter?.chapter === state.chapter &&
    state.translatedChapter?.bookId === String(state.currentBook?.id);

  const chapter = translationIsCurrent
    ? state.translatedChapter
    : originalChapter;

  $("#chapterTitle").textContent =
    chapter.title || originalChapter.title;

  $("#readerText").innerHTML = (chapter.paragraphs || [])
    .map(paragraph => `<p>${esc(paragraph)}</p>`)
    .join("");

  $("#readerText").style.fontSize = `${state.fontSize}px`;

  $("#chapterList").innerHTML = chapters.map((item, index) => `
    <button class="chapter-item ${index === state.chapter ? "active" : ""}" data-chapter="${index}">
      ${index + 1}. ${esc(item.title)}
    </button>`).join("");

  $("#prevChapter").disabled = state.chapter === 0;

  $("#nextChapter").disabled =
    state.chapter >= chapters.length - 1;

  $("#nextChapter").textContent =
    state.chapter >= chapters.length - 1
      ? "Fin del libro"
      : "Siguiente capítulo →";

  updateTranslationButton();

  const container = getReaderScrollContainer();
  if (container) container.scrollTop = 0;

  queueProgressSave();
}

/* VOZ */
function stopSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

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

  const originalChapter = state.content?.chapters?.[state.chapter];
  if (!originalChapter) return;

  const translationIsCurrent =
    state.showingTranslation &&
    state.translatedChapter?.chapter === state.chapter &&
    state.translatedChapter?.bookId === String(state.currentBook?.id);

  const chapter = translationIsCurrent
    ? state.translatedChapter
    : originalChapter;

  const utterance = new SpeechSynthesisUtterance(
    `${chapter.title || originalChapter.title}. ${(chapter.paragraphs || []).join(". ")}`
  );

  // La voz coincide con el idioma del texto que está viendo el lector.
  const language = translationIsCurrent
    ? "es-MX"
    : (state.currentBook?.language === "en" ? "en-US" : "es-MX");

  utterance.lang = language;
  utterance.rate = 0.92;

  const voices = window.speechSynthesis.getVoices();

  const matchingVoice = voices.find(
    voice => voice.lang.toLowerCase() === language.toLowerCase()
  );

  if (matchingVoice) {
    utterance.voice = matchingVoice;
  }

  utterance.onend = () => {
    state.utterance = null;

    const button = $("#listenButton");
    if (button) button.textContent = "▶ Escuchar capítulo";
  };

  utterance.onerror = () => {
    state.utterance = null;

    const button = $("#listenButton");
    if (button) button.textContent = "▶ Escuchar capítulo";

    toast("No se pudo reproducir la voz en este dispositivo.");
  };

  state.utterance = utterance;

  window.speechSynthesis.speak(utterance);

  const button = $("#listenButton");
  if (button) button.textContent = "Ⅱ Detener narración";
}

/* EVENTOS SEGUROS */
function bindEvent(selector, eventName, handler, options) {
  const element = $(selector);

  if (element) {
    element.addEventListener(eventName, handler, options);
  }
}

// Catálogo público
bindEvent("#searchInput", "input", renderBooks);
bindEvent("#categorySelect", "change", renderBooks);

bindEvent("#bookGrid", "click", event => {
  const button = event.target.closest("[data-read]");
  if (button) openBook(button.dataset.read);
});

bindEvent("#privateBookGrid", "click", event => {
  const readButton = event.target.closest("[data-private-read]");
  const deleteButton = event.target.closest("[data-private-delete]");

  if (readButton) {
    openPrivateBook(readButton.dataset.privateRead);
  }

  if (deleteButton) {
    deletePrivateBook(deleteButton.dataset.privateDelete);
  }
});

// Autenticación
bindEvent("#authForm", "submit", submitAuth);

bindEvent("#authSwitch", "click", () => {
  setAuthMode(state.authMode === "login" ? "register" : "login");
});

bindEvent("#logoutButton", "click", logout);

// Lector
bindEvent("#closeReader", "click", () => {
  stopSpeech();

  const dialog = $("#readerDialog");
  if (dialog?.open) dialog.close();

  document.body.classList.remove("reader-open");
});

bindEvent("#readerDialog", "close", () => {
  stopSpeech();
  document.body.classList.remove("reader-open");
});

bindEvent(
  "#readerDialog",
  "scroll",
  () => queueProgressSave(),
  { passive: true }
);

bindEvent("#chapterList", "click", event => {
  const button = event.target.closest("[data-chapter]");

  if (button) {
    stopSpeech();

    state.chapter = Number(button.dataset.chapter);
    state.translatedChapter = null;
    state.showingTranslation = false;

    renderChapter();
  }
});

bindEvent("#prevChapter", "click", () => {
  if (state.chapter > 0) {
    stopSpeech();

    state.chapter--;
    state.translatedChapter = null;
    state.showingTranslation = false;

    renderChapter();
  }
});

bindEvent("#nextChapter", "click", () => {
  if (
    state.content &&
    state.chapter < state.content.chapters.length - 1
  ) {
    stopSpeech();

    state.chapter++;
    state.translatedChapter = null;
    state.showingTranslation = false;

    renderChapter();
  }
});

// Tamaño de letra
bindEvent("#fontDown", "click", () => {
  state.fontSize = Math.max(15, state.fontSize - 1);

  const readerText = $("#readerText");

  if (readerText) {
    readerText.style.fontSize = `${state.fontSize}px`;
  }
});

bindEvent("#fontUp", "click", () => {
  state.fontSize = Math.min(28, state.fontSize + 1);

  const readerText = $("#readerText");

  if (readerText) {
    readerText.style.fontSize = `${state.fontSize}px`;
  }
});

// Tema y narración
bindEvent("#themeToggle", "click", () => {
  const dialog = $("#readerDialog");
  if (dialog) dialog.classList.toggle("dark-reader");
});

bindEvent("#listenButton", "click", toggleSpeech);
bindEvent("#translateButton", "click", translateCurrentChapter);

// Año del pie de página
const yearElement = $("#year");

if (yearElement) {
  yearElement.textContent = new Date().getFullYear();
}

// Inicialización
(async function init() {
  await Promise.all([
    loadBooks(),
    refreshUser()
  ]);
})();
