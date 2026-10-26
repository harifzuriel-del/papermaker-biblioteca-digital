PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'es',
  rights_note TEXT NOT NULL,
  cover_color TEXT NOT NULL DEFAULT '#e9e4d8',
  content_json TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reading_progress (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, book_id)
);

INSERT OR IGNORE INTO books
(id,title,author,category,description,rights_note,cover_color,content_json)
VALUES
('el-jardin-de-las-ideas','El jardín de las ideas','PaperMaker Biblioteca Digital','Cultura','Una lectura breve original sobre curiosidad, aprendizaje y el valor de hacer preguntas.','Texto original de demostración creado para PaperMaker.','#dce8d8',
'{"chapters":[{"title":"Una semilla","paragraphs":["En una pequeña biblioteca había una mesa junto a la ventana. Cada mañana, alguien dejaba allí una pregunta escrita en una tarjeta.","Un día apareció una pregunta sencilla: ¿qué puede crecer cuando compartimos lo que sabemos? La bibliotecaria la colocó junto a una maceta vacía.","Durante semanas, las personas respondieron con historias, dibujos y nuevas preguntas. La maceta recibió una semilla y la mesa se convirtió en un lugar de encuentro."]},{"title":"Lo que se comparte","paragraphs":["Con el tiempo, el jardín se llenó de plantas distintas. Algunas necesitaban sol; otras crecían mejor a la sombra. Ninguna era igual, pero todas tenían un lugar.","La bibliotecaria comprendió que aprender no era acumular respuestas, sino cultivar la curiosidad y ayudar a que otras personas encontraran sus propias preguntas."]}]}'),
('cuaderno-de-estrellas','Cuaderno de estrellas','PaperMaker Biblioteca Digital','Cuentos','Un cuento original breve sobre observar el cielo y aprender con paciencia.','Texto original de demostración creado para PaperMaker.','#e5dff4',
'{"chapters":[{"title":"La primera noche","paragraphs":["Lucía abrió un cuaderno nuevo y escribió la fecha. Quería aprender a reconocer las estrellas, aunque al principio todas le parecían puntos iguales.","Su abuelo le enseñó a observar durante unos minutos antes de buscar nombres. La paciencia, le dijo, también era una herramienta para descubrir."]},{"title":"Un mapa propio","paragraphs":["Cada noche, Lucía dibujaba lo que veía. Algunas líneas estaban torcidas y muchas estrellas cambiaban de lugar en sus páginas, pero sus dibujos mejoraban.","Al final del mes no sabía todo sobre el universo. Sin embargo, había aprendido a mirar con atención, registrar sus hallazgos y seguir haciendo preguntas."]}]}'),
('el-arte-de-leer','El arte de leer despacio','PaperMaker Biblioteca Digital','Lectura y aprendizaje','Una guía original breve para crear un hábito de lectura tranquilo y constante.','Texto original de demostración creado para PaperMaker.','#f3dfc9',
'{"chapters":[{"title":"Un comienzo pequeño","paragraphs":["No hace falta terminar un libro en un día. Puedes comenzar con cinco minutos, una página o un párrafo que despierte tu curiosidad.","Busca un lugar cómodo, reduce las distracciones y permite que la lectura tenga su propio ritmo. La constancia suele ser más útil que la prisa."]},{"title":"Recordar y compartir","paragraphs":["Después de leer, escribe una idea que te haya llamado la atención. No necesitas resumirlo todo: basta con conservar aquello que te hizo pensar.","Cuando compartes una idea con otra persona, la lectura continúa fuera de la página."]}]}');


-- ============================================
-- LIBROS PRIVADOS DE CADA USUARIO
-- ============================================

CREATE TABLE IF NOT EXISTS private_books (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'Autor desconocido',
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_private_books_user_updated
ON private_books(user_id, updated_at DESC);

-- ============================================
-- PROGRESO DE LECTURA DE LIBROS PRIVADOS
-- ============================================

CREATE TABLE IF NOT EXISTS private_reading_progress (
  user_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  chapter INTEGER NOT NULL DEFAULT 0
    CHECK (chapter >= 0 AND chapter <= 10000),
  position INTEGER NOT NULL DEFAULT 0
    CHECK (position >= 0 AND position <= 100000000),
  updated_at TEXT NOT NULL
    DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, book_id),
  FOREIGN KEY (book_id, user_id)
    REFERENCES private_books(id, user_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_private_progress_user
ON private_reading_progress(user_id);
