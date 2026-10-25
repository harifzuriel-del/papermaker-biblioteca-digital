
const $ = (s) => document.querySelector(s);

const state = {
  books: [],
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
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
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

  try {
    data = await response.json();
  } catch {}

  if (!response.ok) {
    throw new Error(data.error || `Error ${response.status}`);
  }

  return data;
}

function toast(message) {
  const el = $("#toast");
  if (!el) return;

  el.textContent = message;
  el.classList.add("show");

  clearTimeout(toast.timer);

  toast.timer = setTimeout(() => {
    el.classList.remove("show");
  }, 3000);
}

function cover(book) {
  return `<div class="cover" style="background:${esc(book.cover_color || "#e9e4d8")}">
    <div class="cover-mark">
      <span>PM / ${esc((book.category || "").toUpperCase())}</span>
      <b>${esc(book.title)}</b>
      <small>PAPERMAKER · BIBLIOTECA</small>
    </div>
  </div>`;
}

function renderBooks() {
  const query = $("#searchInput").value
    .trim()
    .toLocaleLowerCase("es-MX");

  const category = $("#categorySelect").value;

  const books = state.books.filter(b =>
    (!query ||
      `${b.title} ${b.author} ${b.description} ${b.category}`
        .toLocaleLowerCase("es-MX")
        .includes(query)) &&
    (category === "Todas" || b.category === category)
  );

  $("#catalogCount").textContent =
    `${books.length} ${books.length === 1 ? "libro" : "libros"}`;

  $("#bookGrid").innerHTML = books.length
    ? books.map(b => `
      <article class="book-card">
        ${cover(b)}
        <div class="card-body">
          <span class="category-pill">${esc(b.category)}</span>
          <h3>${esc(b.title)}</h3>
          <p class="author">por ${esc(b.author)}</p>
          <p class="description">${esc(b.description)}</p>
          <div class="card-footer">
            <span class="card-type">Lectura digital</span>
            <button class="read-button" data-read="${esc(b.id)}">
              Leer ahora →
            </button>
          </div>
        </div>
      </article>
    `).join("")
    : `<div class="empty-state">No encontramos libros con esa búsqueda. Prueba con otra palabra.</div>`;
}

async function loadBooks() {
  try {
    const data = await api("/api/books");

    state.books = data.books || [];

    const cats = [...new Set(state.books.map(b => b.category))]
      .sort((a, b) => a.localeCompare(b, "es"));

    $("#categorySelect").innerHTML =
      `<option>Todas</option>` +
      cats.map(c => `<option>${esc(c)}</option>`).join("");

    renderBooks();
  } catch (e) {
    $("#catalogCount").textContent = "No se pudo cargar";

    $("#bookGrid").innerHTML = `
      <div class="empty-state">
        No pudimos conectar con la biblioteca. Comprueba que la API y la base D1 estén configuradas.
        <br><br><small>${esc(e.message)}</small>
      </div>`;
  }
}

function setAuthMode(mode) {
  state.authMode = mode;

  const register = mode === "register";

  $("#authTitle").textContent =
    register ? "Crea tu cuenta" : "Inicia sesión";

  $("#authIntro").textContent = register
    ? "Guarda tu progreso y continúa leyendo en otros dispositivos."
    : "Continúa donde te quedaste.";

  $("#nameField").classList.toggle("hidden", !register);
  $("#nameField input").required = register;

  $("#authForm [name=password]").autocomplete =
    register ? "new-password" : "current-password";

  $("#authSubmit").textContent =
    register ? "Crear cuenta gratis" : "Iniciar sesión";

  $("#switchLabel").textContent =
    register ? "¿Ya tienes cuenta?" : "¿Aún no tienes cuenta?";

  $("#switchAuth").textContent =
    register ? "Iniciar sesión" : "Crear cuenta";

  $("#authError").textContent = "";
}

function openAuth(mode = "login") {
  setAuthMode(mode);

  if (!$("#authDialog").open) {
    $("#authDialog").showModal();
  }
}

function renderAccount() {
  $("#accountButton").textContent = state.user
    ? `Hola, ${state.user.name.split(/\s+/)[0]}`
    : "Iniciar sesión";

  $("#heroAccount").textContent =
    state.user ? "Mi cuenta" : "Crear cuenta gratis";

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

      state.progress = Object.fromEntries(
        (p.progress || []).map(x => [x.bookId, x])
      );
    }
  } catch {
    state.user = null;
  }

  renderAccount();
}

async function submitAuth(event) {
  event.preventDefault();

  $("#authError").textContent = "";

  const form = new FormData($("#authForm"));
  const body = Object.fromEntries(form.entries());

  const mode = state.authMode;

  const path = mode === "register"
    ? "/api/auth/register"
    : "/api/auth/login";

  $("#authSubmit").disabled = true;
  $("#authSubmit").textContent = "Un momento…";

  try {
    let data;

    try {
      data = await api(path, {
        method: "POST",
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw new Error("Error en autenticación: " + e.message);
    }

    state.user = data.user;

    try {
      const p = await api("/api/progress");

      state.progress = Object.fromEntries(
        (p.progress || []).map(x => [x.bookId, x])
      );
    } catch (e) {
      console.error("Error al cargar el progreso:", e);

      state.progress = state.progress || {};

      toast("Sesión iniciada, pero no se pudo cargar el progreso.");
    }

    $("#authDialog").close();
    $("#authForm").reset();

    renderAccount();

    toast(
      mode === "register"
        ? "¡Cuenta creada! Ya puedes leer."
        : "Sesión iniciada."
    );

    if (state.currentBook) {
      try {
        await syncProgressFromServer(state.currentBook.id);
      } catch (e) {
        console.error("Error al sincronizar la lectura:", e);
      }
    }
  } catch (e) {
    console.error("Error de autenticación:", e);

    $("#authError").textContent = e.message;
  } finally {
    $("#authSubmit").disabled = false;

    $("#authSubmit").textContent =
      mode === "register"
        ? "Crear cuenta gratis"
        : "Iniciar sesión";
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", {
      method: "POST"
    });
  } catch {}

  clearTimeout(state.saveTimer);

  state.user = null;
  state.progress = {};

  renderAccount();

  toast("Has cerrado sesión.");
}

/* =========================================
   GUARDADO Y RESTAURACIÓN DE LA LECTURA
   El contenedor desplazable es readerDialog.
========================================= */

function getReaderScrollContainer() {
  return $("#readerDialog");
}

function getReadingPosition() {
  const container = getReaderScrollContainer();

  return container
    ? Math.max(0, Math.round(container.scrollTop))
    : 0;
}

function restoreReadingPosition(position) {
  const container = getReaderScrollContainer();

  if (!container) return;

  container.scrollTop = Math.max(
    0,
    Number(position) || 0
  );
}

function queueProgressSave() {
  if (
    !state.user ||
    !state.currentBook ||
    state.isRestoringProgress
  ) {
    return;
  }

  clearTimeout(state.saveTimer);

  state.saveTimer = setTimeout(async () => {
    const book = state.currentBook;

    if (!book || !state.user) return;

    const payload = {
      chapter: state.chapter,
      position: getReadingPosition()
    };

    try {
      await api(
        `/api/progress/${encodeURIComponent(book.id)}`,
        {
          method: "PUT",
          body: JSON.stringify(payload)
        }
      );

      state.progress[book.id] = {
        bookId: book.id,
        ...payload,
        updatedAt: new Date().toISOString()
      };

      $("#syncStatus").textContent =
        "Progreso guardado en tu cuenta.";
    } catch (e) {
      console.error("Error al guardar el progreso:", e);

      $("#syncStatus").textContent =
        "No se pudo sincronizar. Comprueba tu conexión.";
    }
  }, 700);
}

async function syncProgressFromServer(bookId) {
  if (!state.user) return;

  state.isRestoringProgress = true;

  clearTimeout(state.saveTimer);

  try {
    const data = await api("/api/progress");

    state.progress = Object.fromEntries(
      (data.progress || []).map(x => [x.bookId, x])
    );

    const saved = state.progress[bookId];

    if (
      saved &&
      state.currentBook?.id === bookId &&
      state.content?.chapters?.length
    ) {
      const savedChapter = Number(saved.chapter) || 0;

      state.chapter = Math.max(
        0,
        Math.min(
          savedChapter,
          state.content.chapters.length - 1
        )
      );

      // Primero renderiza el capítulo guardado.
      renderChapter();

      // Después restaura el desplazamiento de toda la ventana.
      restoreReadingPosition(saved.position);
    }

    $("#syncStatus").textContent =
      "Progreso sincronizado con tu cuenta.";
  } catch (e) {
    console.error("Error al sincronizar el progreso:", e);

    $("#syncStatus").textContent =
      "No se pudo sincronizar tu progreso.";
  } finally {
    state.isRestoringProgress = false;

    // Guarda el estado restaurado, no el estado temporal anterior.
    if (
      state.currentBook?.id === bookId &&
      state.user
    ) {
      queueProgressSave();
    }
  }
}

/* =========================================
   APERTURA DEL LIBRO Y CAPÍTULOS
========================================= */

async function openBook(id) {
  try {
    const data = await api(
      `/api/books/${encodeURIComponent(id)}`
    );

    clearTimeout(state.saveTimer);

    state.currentBook = data.book;
    state.content = data.content;
    state.chapter = 0;

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
      $("#syncStatus").textContent =
        "Inicia sesión para sincronizar tu progreso entre dispositivos.";
    }
  } catch (e) {
    console.error("Error al abrir el libro:", e);

    toast(e.message);
  }
}

function renderChapter() {
  if (!state.content?.chapters?.length) return;

  const chapters = state.content.chapters;

  state.chapter = Math.max(
    0,
    Math.min(state.chapter, chapters.length - 1)
  );

  const chapter = chapters[state.chapter];

  $("#chapterTitle").textContent = chapter.title;

  $("#readerText").innerHTML = (chapter.paragraphs || [])
    .map(p => `<p>${esc(p)}</p>`)
    .join("");

  $("#readerText").style.fontSize = `${state.fontSize}px`;

  $("#chapterList").innerHTML = chapters.map((c, i) => `
    <button
      class="chapter-item ${i === state.chapter ? "active" : ""}"
      data-chapter="${i}">
      ${i + 1}. ${esc(c.title)}
    </button>
  `).join("");

  $("#prevChapter").disabled = state.chapter === 0;

  $("#nextChapter").disabled =
    state.chapter >= chapters.length - 1;

  $("#nextChapter").textContent =
    state.chapter >= chapters.length - 1
      ? "Fin del libro"
      : "Siguiente capítulo →";

  // Al cambiar de capítulo, empieza desde arriba.
  // La sincronización puede restaurar después la posición guardada.
  const container = getReaderScrollContainer();

  if (container) {
    container.scrollTop = 0;
  }

  queueProgressSave();
}

/* =========================================
   NARRACIÓN DE TEXTO
========================================= */

function stopSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  state.utterance = null;

  $("#listenButton").textContent = "▶ Escuchar capítulo";
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

/* =========================================
   EVENTOS DEL CATÁLOGO Y DE LA CUENTA
========================================= */

$("#searchInput").addEventListener("input", renderBooks);

$("#categorySelect").addEventListener("change", renderBooks);

$("#bookGrid").addEventListener("click", e => {
  const btn = e.target.closest("[data-read]");

  if (btn) {
    openBook(btn.dataset.read);
  }
});

$("#accountButton").addEventListener("click", () => {
  if (state.user) {
    if (confirm("¿Quieres cerrar tu sesión?")) {
      logout();
    }
  } else {
    openAuth("login");
  }
});

$("#heroAccount").addEventListener("click", () => {
  if (state.user) {
    toast("Tu progreso está asociado a tu cuenta.");
  } else {
    openAuth("register");
  }
});

$("#switchAuth").addEventListener("click", () => {
  setAuthMode(
    state.authMode === "login" ? "register" : "login"
  );
});

$("#authForm").addEventListener("submit", submitAuth);

/* =========================================
   EVENTOS DEL LECTOR
========================================= */

$("#closeReader").addEventListener("click", () => {
  stopSpeech();

  $("#readerDialog").close();

  document.body.classList.remove("reader-open");
});

$("#readerDialog").addEventListener("close", () => {
  stopSpeech();

  document.body.classList.remove("reader-open");
});

// Un solo evento para guardar el desplazamiento del lector.
// La posición se obtiene siempre de #readerDialog.
$("#readerDialog").addEventListener(
  "scroll",
  () => {
    queueProgressSave();
  },
  { passive: true }
);

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
  if (
    state.content &&
    state.chapter < state.content.chapters.length - 1
  ) {
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

$("#themeToggle").addEventListener("click", () => {
  $("#readerDialog").classList.toggle("dark-reader");
});

$("#listenButton").addEventListener("click", toggleSpeech);

/* =========================================
   INICIALIZACIÓN
========================================= */

$("#year").textContent = new Date().getFullYear();

(async function init() {
  await Promise.all([
    loadBooks(),
    refreshUser()
  ]);
})();
