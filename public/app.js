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
  showingTranslation: false,
  readerPages: [],
  readerPage: 0
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
    throw new Error(data.error || data.message || `Error ${response.status}`);
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

/* ========================================
   CATÁLOGO PÚBLICO
======================================== */

function renderBooks() {
  const query = $("#searchInput").value.trim().toLocaleLowerCase("es-MX");
  const category = $("#categorySelect").value;

  const books = state.books.filter(b =>
    (!query || `${b.title} ${b.author} ${b.description || ""} ${b.category || ""}`
      .toLocaleLowerCase("es-MX").includes(query)) &&
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
          <p class="description">${esc(b.description || "")}</p>
          <div class="card-footer">
            <span class="card-type">Lectura digital</span>
            <button class="read-button" data-read="${esc(b.id)}">
              Leer ahora →
            </button>
          </div>
        </div>
      </article>
    `).join("")
    : `<div class="empty-state">
        No encontramos libros con esa búsqueda. Prueba con otra palabra.
      </div>`;
}

async function loadBooks() {
  try {
    const data = await api("/api/books");

    state.books = data.books || [];

    const cats = [...new Set(
      state.books.map(b => b.category).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, "es"));

    $("#categorySelect").innerHTML =
      `<option>Todas</option>` +
      cats.map(c => `<option>${esc(c)}</option>`).join("");

    renderBooks();
  } catch (error) {
    $("#catalogCount").textContent = "No se pudo cargar";

    $("#bookGrid").innerHTML = `
      <div class="empty-state">
        No pudimos conectar con la biblioteca.
        Comprueba que la API y la base D1 estén configuradas.
        <br><br>
        <small>${esc(error.message)}</small>
      </div>`;
  }
}

/* ========================================
   BIBLIOTECA PRIVADA
======================================== */

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
    grid.innerHTML = `
      <div class="empty-state">
        No se pudieron cargar tus libros privados.
        <br><br>${esc(error.message)}
      </div>`;
  }
}

function renderPrivateBooks() {
  const grid = $("#privateBookGrid");

  if (!grid) return;
  if (!state.user) {
    grid.innerHTML = "";
    return;
  }

  if (!state.privateBooks.length) {
    grid.innerHTML = `
      <div class="empty-state">
        Todavía no tienes libros privados.
        <br><br>
        Importa tu primer archivo TXT o PDF para comenzar.
      </div>`;
    return;
  }

  grid.innerHTML = state.privateBooks.map(book => `
    <article class="book-card">
      <div class="cover">
        <div class="cover-mark">
          <span>PAPERMAKER · PRIVADO</span>
          <b>${esc(book.title)}</b>
          <small>${esc(book.author)}</small>
        </div>
      </div>

      <div class="card-body">
        <span class="category-pill">Mi biblioteca</span>
        <h3>${esc(book.title)}</h3>
        <p class="author">por ${esc(book.author)}</p>

        <div class="card-footer">
          <button class="read-button"
            data-private-read="${esc(book.id)}">
            Leer ahora →
          </button>

          <button class="button button-outline"
            data-private-delete="${esc(book.id)}"
            aria-label="Eliminar ${esc(book.title)}">
            Eliminar
          </button>
        </div>
      </div>
    </article>
  `).join("");
}

/* ========================================
   SEPARAR TEXTO EN CAPÍTULOS
======================================== */

function splitTextIntoChapters(text) {
  const normalized = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\u00a0/g, " ")
    .trim();

  if (!normalized) {
    throw new Error("El archivo no contiene texto legible.");
  }

  const lines = normalized.split("\n");
  const chapters = [];

  let currentTitle = "Texto inicial";
  let paragraphs = [];

  const numberedHeading =
    /^\s*(?:(?:cap[ií]tulo|chapter)\s+(?:n[úu]mero\s+)?[\divxlcdm]+|(?:parte|part|secci[oó]n|section|libro|book)\s+(?:[\divxlcdm]+|[a-z]))(?:\s*[:.\-–—]\s*|\s+)?(.*)$/i;

  const namedHeading =
    /^\s*(pr[oó]logo|prefacio|introducci[oó]n|ep[ií]logo|conclusi[oó]n|agradecimientos|bibliograf[ií]a|ap[eé]ndice|dedicatoria|foreword|preface|introduction|epilogue|afterword|acknowledgments|acknowledgements|bibliography|appendix|dedication)\s*[:.]?\s*$/i;

  const isContentsLine =
    /^\s*(?:[ivxlcdm]+|\d+)?\s*(?:[.)-]\s*)?(?:cap[ií]tulo|chapter|parte|part|secci[oó]n|section)\b.*(?:\.{2,}|…{1,}|\s{2,}\d+\s*$)/i;

  function cleanParagraphs(sourceLines) {
    const result = [];
    let buffer = [];

    function flush() {
      const paragraph = buffer
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (paragraph) result.push(paragraph);
      buffer = [];
    }

    for (const rawLine of sourceLines) {
      const line = rawLine.replace(/\s+/g, " ").trim();

      if (!line) {
        flush();
        continue;
      }

      buffer.push(line);
    }

    flush();
    return result;
  }

  function saveChapter() {
    const cleaned = cleanParagraphs(paragraphs);

    if (cleaned.length) {
      chapters.push({
        title: currentTitle,
        paragraphs: cleaned
      });
    }

    paragraphs = [];
  }

  let inContents = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      paragraphs.push("");
      continue;
    }

    if (/^(?:índice|indice|tabla de contenido|contenido|contents|table of contents)\s*:?\s*$/i.test(line)) {
      inContents = true;
      paragraphs.push(line);
      continue;
    }

    const explicitMatch = line.match(numberedHeading);
    const namedMatch = line.match(namedHeading);

    const isNumberedHeading =
      explicitMatch &&
      line.length <= 140 &&
      !isContentsLine.test(line);

    const isNamedHeading =
      namedMatch &&
      line.length <= 100;

    if (isNumberedHeading || isNamedHeading) {
      if (inContents) {
        const nextLines = lines.slice(i + 1, i + 4).join(" ");

        const looksLikeRealSection =
          !/\b(?:cap[ií]tulo|chapter|p[aá]gina|page)\b/i.test(nextLines) ||
          /^(?:pr[oó]logo|prefacio|introducci[oó]n|cap[ií]tulo|chapter)\b/i.test(line);

        if (!looksLikeRealSection) {
          paragraphs.push(line);
          continue;
        }

        inContents = false;
      }

      saveChapter();

      currentTitle = isNamedHeading
        ? line.replace(/[:.]$/, "").trim()
        : explicitMatch[0].trim();

      continue;
    }

    paragraphs.push(line);
  }

  saveChapter();

  if (!chapters.length) {
    const cleaned = cleanParagraphs(lines);

    if (!cleaned.length) {
      throw new Error("No se pudo extraer texto legible del PDF.");
    }

    chapters.push({
      title: "Texto inicial",
      paragraphs: cleaned
    });
  }

  if (chapters.length > 1000) {
    throw new Error("El archivo contiene más de 1,000 secciones.");
  }

  const total = chapters.reduce(
    (sum, chapter) =>
      sum + chapter.paragraphs.reduce(
        (n, paragraph) => n + paragraph.length,
        0
      ),
    0
  );

  if (total > 1000000) {
    throw new Error("El libro supera el límite de un millón de caracteres.");
  }

  return { chapters };
}

/* ========================================
   IMPORTAR TXT Y PDF
======================================== */

async function extractImportedText(file) {
  const extension = file.name.split(".").pop().toLowerCase();

  if (extension === "txt") {
    return await file.text();
  }

  if (extension !== "pdf") {
    throw new Error("Selecciona un archivo TXT o PDF.");
  }

  if (!window.pdfjsLib) {
    throw new Error("No se pudo cargar PDF.js. Recarga la página e inténtalo de nuevo.");
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const pdf = await window.pdfjsLib.getDocument({
    data: new Uint8Array(await file.arrayBuffer())
  }).promise;

  const pages = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();

    const items = content.items
      .filter(x => typeof x.str === "string")
      .map(x => ({
        text: x.str,
        y: x.transform ? x.transform[5] : 0
      }));

    let pageText = "";
    let previousY = null;

    for (const item of items) {
      if (previousY !== null && Math.abs(item.y - previousY) > 4) {
        pageText += "\n";
      } else if (pageText && !pageText.endsWith("\n")) {
        pageText += " ";
      }

      pageText += item.text;
      previousY = item.y;
    }

    pages.push(pageText);
  }

  const text = pages.join("\n\n");

  if (!text.trim()) {
    throw new Error("Este PDF no contiene texto extraíble. Si es un escaneo, necesitará OCR.");
  }

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
  const language = $("#privateBookLanguage").value;
  const file = $("#privateBookFile").files[0];

  if (!title || !author || !file) {
    errorEl.textContent =
      "Completa el título, el autor y selecciona un archivo.";
    return;
  }

  if (!["es", "en"].includes(language)) {
    errorEl.textContent = "Selecciona un idioma válido.";
    return;
  }

  button.disabled = true;
  button.textContent = "Procesando archivo…";

  try {
    const content = splitTextIntoChapters(
      await extractImportedText(file)
    );

    button.textContent = "Guardando libro…";

    const result = await api("/api/private-books", {
      method: "POST",
      body: JSON.stringify({
        title,
        author,
        language,
        content
      })
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
  const book = state.privateBooks.find(
    b => String(b.id) === String(id)
  );

  if (!book || !confirm(`¿Eliminar "${book.title}" de tus libros privados?`)) {
    return;
  }

  try {
    await api(`/api/private-books/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    state.privateBooks = state.privateBooks.filter(
      b => String(b.id) !== String(id)
    );

    if (
      state.currentBook?.isPrivate &&
      String(state.currentBook.id) === String(id)
    ) {
      clearTimeout(state.saveTimer);
      stopSpeech();

      if ($("#readerDialog").open) {
        $("#readerDialog").close();
      }

      state.currentBook = null;
      state.content = null;
      state.translatedChapter = null;
      state.showingTranslation = false;
    }

    renderPrivateBooks();
    toast("Libro privado eliminado.");
  } catch (error) {
    toast(error.message);
  }
}

/* ========================================
   AUTENTICACIÓN
======================================== */

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
        (p.progress || []).map(x => [String(x.bookId), x])
      );
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

  const body = Object.fromEntries(
    new FormData($("#authForm")).entries()
  );

  const mode = state.authMode;

  const path = mode === "register"
    ? "/api/auth/register"
    : "/api/auth/login";

  $("#authSubmit").disabled = true;
  $("#authSubmit").textContent = "Un momento…";

  try {
    const data = await api(path, {
      method: "POST",
      body: JSON.stringify(body)
    });

    state.user = data.user;

    try {
      const p = await api("/api/progress");

      state.progress = Object.fromEntries(
        (p.progress || []).map(x => [String(x.bookId), x])
      );
    } catch (error) {
      console.error("Error al cargar el progreso:", error);
      toast("Sesión iniciada, pero no se pudo cargar el progreso público.");
    }

    $("#authDialog").close();
    $("#authForm").reset();

    renderAccount();
    await loadPrivateBooks();

    toast(
      mode === "register"
        ? "¡Cuenta creada! Ya puedes leer."
        : "Sesión iniciada."
    );

    if (state.currentBook) {
      if (state.currentBook.isPrivate) {
        await syncPrivateProgressFromServer(state.currentBook.id);
      } else {
        await syncProgressFromServer(state.currentBook.id);
      }
    }
  } catch (error) {
    console.error("Error de autenticación:", error);
    $("#authError").textContent = error.message;
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
    await api("/api/auth/logout", { method: "POST" });
  } catch {}

  clearTimeout(state.saveTimer);

  state.user = null;
  state.progress = {};
  state.privateProgress = {};
  state.privateBooks = [];

  if (state.currentBook?.isPrivate) {
    stopSpeech();

    if ($("#readerDialog").open) {
      $("#readerDialog").close();
    }

    state.currentBook = null;
    state.content = null;
    state.translatedChapter = null;
    state.showingTranslation = false;
  }

  renderAccount();
  await loadPrivateBooks();

  toast("Has cerrado sesión.");
}


/* ========================================
   PAGINACIÓN REAL DEL LIBRO
======================================== */

function getReaderScrollContainer() {
  return $("#readerText");
}

function getPagesPerSpread() {
  return window.innerWidth <= 700 ? 1 : 2;
}

function getReaderPageCount() {
  return Math.max(1, state.readerPages.length);
}

function getReadingPosition() {
  return Math.max(0, Number(state.readerPage) || 0);
}

function ensureReaderPageControls() {
  const readerText = $("#readerText");

  if (!readerText || $("#readerPageControls")) return;

  const controls = document.createElement("div");
  controls.id = "readerPageControls";
  controls.className = "reader-page-controls";

  controls.innerHTML = `
    <button id="readerPagePrev"
      class="button button-outline" type="button">
      ← Anterior
    </button>

    <span id="readerPageStatus" aria-live="polite">
      Página 1 de 1
    </span>

    <button id="readerPageNext"
      class="button" type="button">
      Siguiente →
    </button>
  `;

  readerText.insertAdjacentElement("afterend", controls);

  $("#readerPagePrev").addEventListener("click", () => {
    changeReaderPage(-1);
  });

  $("#readerPageNext").addEventListener("click", () => {
    changeReaderPage(1);
  });
}

function updateReaderPageControls() {
  const status = $("#readerPageStatus");
  const previous = $("#readerPagePrev");
  const next = $("#readerPageNext");

  if (!status || !previous || !next) return;

  const total = getReaderPageCount();
  const perSpread = getPagesPerSpread();

  const spread = Math.floor(state.readerPage / perSpread);
  const totalSpreads = Math.ceil(total / perSpread);

  const firstPage = spread * perSpread + 1;
  const lastPage = Math.min(total, firstPage + perSpread - 1);

  status.textContent = firstPage === lastPage
    ? `Página ${firstPage} de ${total}`
    : `Páginas ${firstPage}-${lastPage} de ${total}`;

  previous.disabled = state.readerPage <= 0;
  next.disabled = state.readerPage + perSpread >= total;
}

function displayReaderSpread() {
  const container = $("#readerText");
  if (!container) return;

  const perSpread = getPagesPerSpread();
  const start = Math.floor(state.readerPage / perSpread) * perSpread;

  const visiblePages = state.readerPages.slice(
    start,
    start + perSpread
  );

  container.innerHTML = visiblePages.map((html, index) => `
    <article class="reader-paper-page">
      ${html}
      <span class="reader-paper-page-number">
        ${start + index + 1}
      </span>
    </article>
  `).join("");

  updateReaderPageControls();
}

function changeReaderPage(direction) {
  const perSpread = getPagesPerSpread();

  const total = getReaderPageCount();
  const totalSpreads = Math.ceil(total / perSpread);

  const currentSpread = Math.floor(
    state.readerPage / perSpread
  );

  const nextSpread = Math.max(
    0,
    Math.min(totalSpreads - 1, currentSpread + direction)
  );

  state.readerPage = nextSpread * perSpread;

  displayReaderSpread();
  queueProgressSave();
}

function restoreReadingPosition(position) {
  const total = getReaderPageCount();

  state.readerPage = Math.max(
    0,
    Math.min(Number(position) || 0, total - 1)
  );

  displayReaderSpread();
}


function paginateReaderContent(paragraphs) {
  const container = $("#readerText");

  if (!container) return;

  const perSpread = getPagesPerSpread();

  const pageWidth = perSpread === 1
    ? container.clientWidth
    : (container.clientWidth - 18) / 2;

  const pageHeight = container.clientHeight;

  if (!pageWidth || !pageHeight) {
    requestAnimationFrame(() => {
      paginateReaderContent(paragraphs);
    });
    return;
  }

  const probe = document.createElement("article");
  probe.className = "reader-paper-page";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.left = "-10000px";
  probe.style.top = "0";
  probe.style.width = `${pageWidth}px`;
  probe.style.height = `${pageHeight}px`;

  document.body.appendChild(probe);

  const pages = [];
  const pageAnchors = [];

  let currentPage = [];
  let currentHeight = 0;
  let currentStartIndex = null;

  const computed = getComputedStyle(probe);

  const contentHeight =
    pageHeight -
    parseFloat(computed.paddingTop) -
    parseFloat(computed.paddingBottom);

  function savePage() {
    if (!currentPage.length) return;

    pages.push(currentPage.join(""));
    pageAnchors.push(currentStartIndex);

    currentPage = [];
    currentHeight = 0;
    currentStartIndex = null;

    probe.innerHTML = "";
  }

  function addParagraph(text, paragraphIndex) {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    probe.appendChild(paragraph);

    const height = paragraph.getBoundingClientRect().height;

    if (currentHeight + height <= contentHeight) {
      if (currentStartIndex === null) {
        currentStartIndex = paragraphIndex;
      }

      currentPage.push(`<p>${esc(text)}</p>`);
      currentHeight += height;
      return;
    }

    probe.removeChild(paragraph);

    if (currentPage.length) {
      savePage();
      addParagraph(text, paragraphIndex);
      return;
    }

    /* Párrafo demasiado largo: dividir por palabras */
    const words = text.split(/\s+/);
    let remaining = words;

    while (remaining.length) {
      let low = 1;
      let high = remaining.length;
      let best = 1;

      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const part = remaining.slice(0, middle).join(" ");

        const test = document.createElement("p");
        test.textContent = part;
        probe.appendChild(test);

        const fits =
          test.getBoundingClientRect().height <= contentHeight;

        probe.removeChild(test);

        if (fits) {
          best = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }

      const part = remaining.slice(0, best).join(" ");

      if (currentStartIndex === null) {
        currentStartIndex = paragraphIndex;
      }

      currentPage.push(`<p>${esc(part)}</p>`);

      remaining = remaining.slice(best);

      savePage();
    }
  }

  paragraphs.forEach((paragraph, index) => {
    addParagraph(String(paragraph), index);
  });

  savePage();
  probe.remove();

  state.readerPages = pages.length ? pages : [""];
  state.readerPageAnchors = pageAnchors;

  state.readerPage = Math.min(
    state.readerPage,
    state.readerPages.length - 1
  );

  displayReaderSpread();
}



/* ========================================
   GUARDAR PROGRESO
======================================== */

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

    const isPrivate = book.isPrivate === true;

    const endpoint = isPrivate
      ? `/api/private-progress/${encodeURIComponent(book.id)}`
      : `/api/progress/${encodeURIComponent(book.id)}`;

    try {
      await api(endpoint, {
        method: "PUT",
        body: JSON.stringify(payload)
      });

      const entry = {
        bookId: book.id,
        ...payload,
        updatedAt: new Date().toISOString()
      };

      if (isPrivate) {
        state.privateProgress[String(book.id)] = entry;
      } else {
        state.progress[String(book.id)] = entry;
      }

      $("#syncStatus").textContent =
        "Progreso guardado en tu cuenta.";
    } catch (error) {
      console.error("Error al guardar el progreso:", error);

      $("#syncStatus").textContent =
        "No se pudo sincronizar. Comprueba tu conexión.";
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
      (data.progress || []).map(item => [
        String(item.bookId),
        item
      ])
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
        Math.min(
          Number(saved.chapter) || 0,
          state.content.chapters.length - 1
        )
      );

      renderChapter(saved.position);
    }

    $("#syncStatus").textContent =
      "Progreso del libro privado sincronizado.";

  } catch (error) {
    console.error(
      "Error al sincronizar el progreso privado:",
      error
    );

    $("#syncStatus").textContent =
      "No se pudo sincronizar el progreso privado.";

  } finally {
    state.isRestoringProgress = false;

    if (
      state.currentBook?.isPrivate &&
      String(state.currentBook?.id) === String(bookId) &&
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
      (data.progress || []).map(x => [
        String(x.bookId),
        x
      ])
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
        Math.min(
          Number(saved.chapter) || 0,
          state.content.chapters.length - 1
        )
      );

      renderChapter(saved.position);
    }

    $("#syncStatus").textContent =
      "Progreso sincronizado con tu cuenta.";

  } catch (error) {
    console.error("Error al sincronizar el progreso:", error);

    $("#syncStatus").textContent =
      "No se pudo sincronizar tu progreso.";

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
/* ========================================
   ABRIR LIBROS
======================================== */

async function openBook(id) {
  try {
    const data = await api(
      `/api/books/${encodeURIComponent(id)}`
    );

    clearTimeout(state.saveTimer);
    stopSpeech();

    state.currentBook = {
      ...data.book,
      isPrivate: false
    };

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
      $("#syncStatus").textContent =
        "Inicia sesión para sincronizar tu progreso entre dispositivos.";
    }
  } catch (error) {
    console.error("Error al abrir el libro:", error);
    toast(error.message);
  }
}

async function openPrivateBook(id) {
  try {
    const data = await api(
      `/api/private-books/${encodeURIComponent(id)}`
    );

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
      $("#syncStatus").textContent =
        "Inicia sesión para guardar tu progreso.";
    }
  } catch (error) {
    console.error("Error al abrir el libro privado:", error);
    toast(error.message);
  }
}

/* ========================================
   TRADUCCIÓN
======================================== */

function canTranslateCurrentBook() {
  return state.currentBook?.isPrivate === true &&
    state.currentBook?.language === "en";
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

async function translateCurrentChapter() {
  const button = $("#translateButton");

  if (!canTranslateCurrentBook()) {
    toast("La traducción está disponible para libros privados en inglés.");
    return;
  }

  const bookId = String(state.currentBook.id);
  const chapterIndex = state.chapter;

  if (
    state.translatedChapter?.bookId === bookId &&
    state.translatedChapter?.chapter === chapterIndex
  ) {
    toggleChapterTranslation();
    return;
  }

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
          chapter: chapterIndex
        })
      }
    );

    if (
      String(state.currentBook?.id) !== bookId ||
      state.chapter !== chapterIndex
    ) {
      return;
    }

    if (!result?.ok || !Array.isArray(result.paragraphs)) {
      throw new Error("El servidor no devolvió una traducción válida.");
    }

    state.translatedChapter = {
      bookId,
      chapter: chapterIndex,
      title: result.title ||
        state.content.chapters[chapterIndex].title,
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

function toggleChapterTranslation() {
  if (
    !state.translatedChapter ||
    state.translatedChapter.bookId !== String(state.currentBook?.id) ||
    state.translatedChapter.chapter !== state.chapter
  ) {
    return;
  }

  stopSpeech();

  state.showingTranslation = !state.showingTranslation;

  renderChapter();
}
/* ========================================
   RENDERIZAR CAPÍTULO
======================================== */

function renderChapter(positionToRestore = null) {
  if (!state.content?.chapters?.length) return;

  const chapters = state.content.chapters;

  state.chapter = Math.max(
    0,
    Math.min(state.chapter, chapters.length - 1)
  );

  const originalChapter = chapters[state.chapter];

  const hasCurrentTranslation =
    state.showingTranslation &&
    state.translatedChapter?.bookId === String(state.currentBook?.id) &&
    state.translatedChapter?.chapter === state.chapter;

  const chapter = hasCurrentTranslation
    ? state.translatedChapter
    : originalChapter;

  $("#chapterTitle").textContent =
    chapter.title || originalChapter.title;

  $("#readerText").innerHTML = "";
  $("#readerText").style.fontSize = `${state.fontSize}px`;

  state.readerPages = [];
  state.readerPage = 0;

  ensureReaderPageControls();

  $("#chapterList").innerHTML = chapters.map((item, index) => `
    <button
      class="chapter-item ${index === state.chapter ? "active" : ""}"
      data-chapter="${index}">
      ${index + 1}. ${esc(item.title)}
    </button>
  `).join("");

  $("#prevChapter").disabled = state.chapter === 0;

  $("#nextChapter").disabled =
    state.chapter >= chapters.length - 1;

  $("#nextChapter").textContent =
    state.chapter >= chapters.length - 1
      ? "Fin del libro"
      : "Siguiente capítulo →";

  updateTranslationButton();

  const paragraphs = chapter.paragraphs || [];

  requestAnimationFrame(() => {
    paginateReaderContent(paragraphs);

    if (positionToRestore !== null) {
      restoreReadingPosition(positionToRestore);
    }

    queueProgressSave();
  });
}

/* ========================================
   NARRACIÓN DE VOZ
======================================== */

function stopSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }

  state.utterance = null;

  const button = $("#listenButton");

  if (button) {
    button.textContent = "▶ Escuchar capítulo";
  }
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

  const originalChapter =
    state.content?.chapters?.[state.chapter];

  if (!originalChapter) return;

  const isTranslated =
    state.showingTranslation &&
    state.translatedChapter?.bookId === String(state.currentBook?.id) &&
    state.translatedChapter?.chapter === state.chapter;

  const chapter = isTranslated
    ? state.translatedChapter
    : originalChapter;

  const utterance = new SpeechSynthesisUtterance(
    `${chapter.title || originalChapter.title}. ${(chapter.paragraphs || []).join(". ")}`
  );

  const language = isTranslated
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

    if (button) {
      button.textContent = "▶ Escuchar capítulo";
    }
  };

  utterance.onerror = () => {
    state.utterance = null;

    const button = $("#listenButton");

    if (button) {
      button.textContent = "▶ Escuchar capítulo";
    }

    toast("No se pudo reproducir la voz en este dispositivo.");
  };

  state.utterance = utterance;

  window.speechSynthesis.speak(utterance);

  const button = $("#listenButton");

  if (button) {
    button.textContent = "Ⅱ Detener narración";
  }
}

/* ========================================
   EVENTOS SEGUROS
======================================== */

function bindEvent(selector, eventName, handler, options) {
  const element = $(selector);

  if (element) {
    element.addEventListener(eventName, handler, options);
  }
}

/* CATÁLOGO */

bindEvent("#searchInput", "input", renderBooks);
bindEvent("#categorySelect", "change", renderBooks);

bindEvent("#bookGrid", "click", event => {
  const button = event.target.closest("[data-read]");

  if (button) {
    openBook(button.dataset.read);
  }
});

/* CUENTA */

bindEvent("#accountButton", "click", () => {
  if (state.user) {
    if (confirm("¿Quieres cerrar tu sesión?")) {
      logout();
    }
  } else {
    openAuth("login");
  }
});

bindEvent("#heroAccount", "click", () => {
  if (state.user) {
    toast("Tu progreso está asociado a tu cuenta.");
  } else {
    openAuth("register");
  }
});

bindEvent("#switchAuth", "click", () => {
  setAuthMode(
    state.authMode === "login" ? "register" : "login"
  );
});

bindEvent("#authForm", "submit", submitAuth);

/* IMPORTACIÓN */

bindEvent("#importBookButton", "click", openImportDialog);
bindEvent("#importBookForm", "submit", importPrivateBook);

bindEvent("#closeImportBookDialog", "click", () => {
  const dialog = $("#importBookDialog");

  if (dialog) {
    dialog.close();
  }
});

/* BIBLIOTECA PRIVADA */

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

/* LECTOR */

bindEvent("#closeReader", "click", () => {
  stopSpeech();

  const dialog = $("#readerDialog");

  if (dialog?.open) {
    dialog.close();
  }

  document.body.classList.remove("reader-open");
});

bindEvent("#readerDialog", "close", () => {
  stopSpeech();

  document.body.classList.remove("reader-open");
});



window.addEventListener("resize", () => {
  if (!state.content?.chapters?.length) return;

  const chapter = state.showingTranslation
    ? state.translatedChapter
    : state.content.chapters[state.chapter];

  if (!chapter?.paragraphs) return;

  const paragraphAnchor = getCurrentParagraphAnchor();

  requestAnimationFrame(() => {
    paginateReaderContent(chapter.paragraphs);
    restoreParagraphAnchor(paragraphAnchor);
  });
});



/* CAPÍTULOS */

bindEvent("#chapterList", "click", event => {
  const button = event.target.closest("[data-chapter]");

  if (!button) return;

  stopSpeech();

  state.chapter = Number(button.dataset.chapter);
  state.translatedChapter = null;
  state.showingTranslation = false;

  renderChapter();
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

function getCurrentParagraphAnchor() {
  const anchors = state.readerPageAnchors || [];

  return anchors[state.readerPage] ?? 0;
}


function restoreParagraphAnchor(paragraphIndex) {
  const anchors = state.readerPageAnchors || [];

  let targetPage = anchors.findIndex(
    index => index === paragraphIndex
  );

  if (targetPage === -1) {
    for (let i = 0; i < anchors.length; i++) {
      if (anchors[i] <= paragraphIndex) {
        targetPage = i;
      } else {
        break;
      }
    }
  }

  state.readerPage = Math.max(0, targetPage);

  state.readerPage = Math.min(
    state.readerPage,
    state.readerPages.length - 1
  );

  displayReaderSpread();

  queueProgressSave();
}

/* TAMAÑO DE LETRA */

bindEvent("#fontDown", "click", () => {
  const paragraphAnchor = getCurrentParagraphAnchor();

  state.fontSize = Math.max(15, state.fontSize - 1);

  const readerText = $("#readerText");

  if (readerText) {
    readerText.style.fontSize = `${state.fontSize}px`;

    const paragraphs = state.showingTranslation
      ? state.translatedChapter?.paragraphs
      : state.content?.chapters?.[state.chapter]?.paragraphs;

    if (paragraphs) {
      requestAnimationFrame(() => {
        paginateReaderContent(paragraphs);
        restoreParagraphAnchor(paragraphAnchor);
      });
    }
  }
});

bindEvent("#fontUp", "click", () => {
  const paragraphAnchor = getCurrentParagraphAnchor();

  state.fontSize = Math.min(28, state.fontSize + 1);

  const readerText = $("#readerText");

  if (readerText) {
    readerText.style.fontSize = `${state.fontSize}px`;

    const paragraphs = state.showingTranslation
      ? state.translatedChapter?.paragraphs
      : state.content?.chapters?.[state.chapter]?.paragraphs;

    if (paragraphs) {
      requestAnimationFrame(() => {
        paginateReaderContent(paragraphs);
        restoreParagraphAnchor(paragraphAnchor);
      });
    }
  }
});



/* TEMA Y NARRACIÓN */

bindEvent("#themeToggle", "click", () => {
  const dialog = $("#readerDialog");

  if (dialog) {
    dialog.classList.toggle("dark-reader");
  }
});

bindEvent("#listenButton", "click", toggleSpeech);

/* TRADUCCIÓN */

bindEvent("#translateButton", "click", () => {
  if (state.showingTranslation) {
    toggleChapterTranslation();
  } else {
    translateCurrentChapter();
  }
});

/* ========================================
   AÑO DEL PIE DE PÁGINA
======================================== */

const yearElement = $("#year");

if (yearElement) {
  yearElement.textContent = new Date().getFullYear();
}

/* ========================================
   INICIALIZACIÓN
======================================== */

(async function init() {
  await Promise.all([
    loadBooks(),
    refreshUser()
  ]);
})();
