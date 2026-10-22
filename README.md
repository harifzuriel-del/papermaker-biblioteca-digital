# PaperMaker Biblioteca Digital — MVP

Proyecto independiente para publicar en Cloudflare Pages. Incluye catálogo, registro/inicio de sesión, lectura de textos de muestra y sincronización de progreso entre dispositivos mediante Cloudflare D1.

## Importante
- No modifica el Worker ni la Skill de Alexa de PaperMaker.
- Crea una **base D1 nueva** para esta biblioteca.
- Esta es una base funcional para comenzar, no una plataforma editorial terminada.
- Los textos de muestra incluidos son fragmentos de demostración escritos para este proyecto; agrega libros completos solo cuando hayas verificado que su distribución está permitida en México.
- La aplicación usa cookies de sesión HttpOnly y contraseñas derivadas con PBKDF2.
- Para producción, configura un dominio HTTPS, límites contra intentos repetidos de acceso y un proceso de recuperación de contraseña.

## Archivos
- `public/`: aplicación web.
- `functions/api/`: API de Cloudflare Pages Functions.
- `schema.sql`: estructura de D1.
- `wrangler.toml.example`: ejemplo de configuración.

## Publicar en Cloudflare Pages
1. Descomprime el ZIP.
2. Sube la carpeta del proyecto a un repositorio Git (GitHub, por ejemplo).
3. En Cloudflare, entra en **Workers & Pages → Create → Pages → Connect to Git** y selecciona el repositorio.
4. Configura el directorio raíz como la raíz del proyecto, y el directorio de salida como `public`.
5. En el proyecto Pages, abre **Settings → Functions → D1 database bindings** y agrega un binding:
   - Variable name: `DB`
   - Database: crea una base nueva, por ejemplo `papermaker-biblioteca-db`
6. En esa base D1, ejecuta el contenido de `schema.sql` desde la consola de D1 o con Wrangler:
   `npx wrangler d1 execute papermaker-biblioteca-db --remote --file=schema.sql`
7. Vuelve a desplegar Pages.

No conectes esta app a la base `papermaker_db` del punto de venta.

## Probar localmente
Necesitas Node.js y Wrangler:
1. Instala Wrangler: `npm install -D wrangler`
2. Crea una base D1 local/remota y configura el binding `DB`.
3. Para desarrollo local, `npx wrangler pages dev public` puede servir los archivos, pero las Functions y D1 deben ejecutarse con la configuración Wrangler del proyecto. Consulta la documentación actual de Cloudflare Pages Functions/D1 para ajustar el entorno local.
4. Para una primera prueba sencilla, publica el proyecto en una URL de Pages y comprueba registro, inicio de sesión, abrir un libro y guardar progreso.

## Funciones incluidas
- Crear cuenta, iniciar sesión y cerrar sesión.
- Cookie de sesión HttpOnly, Secure en producción, SameSite=Lax.
- Catálogo con búsqueda y categorías.
- Lector con tamaño de texto, modo oscuro y narración del navegador si el dispositivo lo admite.
- Guardado de capítulo/posición por usuario y libro; al iniciar sesión desde otro dispositivo se recupera el progreso.
- Endpoints JSON bajo `/api/`.

## Endpoints
- `GET /api/books`
- `GET /api/books/:id`
- `POST /api/auth/register` — `{ "name": "...", "email": "...", "password": "..." }`
- `POST /api/auth/login` — `{ "email": "...", "password": "..." }`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/progress`
- `PUT /api/progress/:bookId` — `{ "chapter": 1, "position": 0 }`

## Limitaciones del MVP
- No incluye recuperación de contraseña, administración visual de libros, pagos, audiolibros narrados profesionalmente ni integración Alexa todavía.
- La narración usa `speechSynthesis` del navegador; las voces disponibles dependen del dispositivo/navegador y no se sincroniza audio con Alexa.
- La sesión expira a las 7 jornadas.
