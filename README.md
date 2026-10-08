# Playtime

Aplicación de escritorio para reunir biblioteca, horas de juego, logros y estadísticas de Steam. Está construida con Tauri 2, React y TypeScript.

## Estado actual

La aplicación permite iniciar sesión mediante Steam OpenID, consultar biblioteca/horas/logros con la Steam Web API, buscar juegos y personalizar el aspecto. La clave de API personal se guarda en el Administrador de credenciales de Windows.

En Windows, la versión instalada configura Playtime para iniciarse al iniciar sesión en el sistema. En ese inicio se ejecuta en segundo plano: la ventana se puede abrir desde el icono de Playtime en la bandeja del sistema. Cerrar la ventana con la X la oculta; el menú del icono permite volver a abrirla o salir completamente.

## Conectar Steam

1. Inicia Playtime e inicia sesión desde **Conectar Steam**. La contraseña se introduce únicamente en la página oficial de Steam.
2. En **Ajustes**, abre la página oficial de claves Web API, crea una clave personal y usa `localhost` como dominio si te lo pide.
3. Pega la clave en Playtime y guárdala. La aplicación la almacena en el Administrador de credenciales de Windows y la utiliza desde Rust; no la incorpora al frontend, al instalador ni a un servidor remoto.
4. Pon en público los detalles de juegos de tu perfil de Steam para que la Web API pueda leer la biblioteca y las horas. Usa **Actualizar datos** después de cambiar la privacidad.

La sincronización consulta el perfil, la biblioteca y las horas de juego. También solicita logros de cada juego devuelto por la biblioteca; Steam puede no devolver estadísticas o nombres/descripciones de algunos títulos, y la aplicación indica estos casos. La primera sincronización de logros puede tardar si se han jugado muchos títulos.

Los logros se consultan juego por juego para todos los juegos devueltos por la biblioteca, incluidos los que indican 0 minutos. Steam no ofrece a esta aplicación una cifra global de logros desbloqueados de la cuenta; el total mostrado suma los logros que devolvieron las estadísticas disponibles. Las consultas que fallan de forma temporal se reintentan hasta dos veces. En **Logros**, Playtime muestra el nombre y el motivo de los juegos para los que Steam no devolvió datos; una respuesta correcta sin logros se cuenta como consulta completada.

Steam OpenID confirma la identidad, pero no concede acceso a contenido privado. La Steam Web API no ofrece un endpoint general para el historial completo de compras o fechas de adquisición, ni datos diarios históricos de tiempo de juego. No se solicita ni se almacena la contraseña de Steam.

Para desconectar la cuenta y borrar la clave del Administrador de credenciales, ve a **Ajustes** y usa **Desconectar y borrar clave**.

## Actualizaciones de Playtime

El botón de flechas, junto a la campana, busca una actualización firmada y, si la encuentra, la descarga y ejecuta el instalador de Windows. Solo instala paquetes cuya firma coincida con la clave pública configurada.

Las versiones se publican en GitHub Releases de `CODWARRIORHQ/playtime`. El workflow `.github/workflows/release.yml` compila y firma los instaladores, y adjunta `latest.json`. Para habilitar las publicaciones:

1. Crea el repositorio público `CODWARRIORHQ/playtime` y sube el código.
2. En PowerShell, crea la carpeta de claves y genera la clave de firma con `New-Item -ItemType Directory -Force "$env:USERPROFILE\.tauri"` y `npm.cmd run tauri signer generate -- --write-keys "$env:USERPROFILE\.tauri\playtime.key"`. Conserva y protege el archivo privado: si se pierde, habrá que reinstalar la aplicación para cambiar la clave de confianza.
3. La clave pública generada debe estar configurada en `src-tauri/tauri.conf.json`. La clave pública sí se puede publicar; no la sustituyas por la privada.
4. En **Settings → Secrets and variables → Actions** del repositorio, crea el secreto `TAURI_SIGNING_PRIVATE_KEY` con el contenido del archivo privado y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` con su contraseña (vacío si no definiste ninguna). Nunca subas la clave privada al repositorio ni la compartas por chat.
5. Actualiza las versiones de `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json` en cada lanzamiento. Crea y publica una etiqueta Git `v` seguida de esa versión (por ejemplo, `v0.4.0`); Actions construirá el release y el actualizador lo detectará.

## Requisitos para ejecutar en Windows

- Node.js y npm
- Rust y Cargo (instalados con [rustup](https://www.rust-lang.org/tools/install))
- Microsoft C++ Build Tools y WebView2; consulta los [requisitos de Tauri para Windows](https://tauri.app/start/prerequisites/)

## Desarrollo

```powershell
npm install
npm run tauri dev
```

## Compilar el instalador

```powershell
npm run tauri build
```

Los instaladores se generan bajo `src-tauri/target/release/bundle/`.

## Nota de privacidad

El color de acento, la preferencia de interfaz compacta y el historial local de horas se guardan en el almacenamiento local del frontend. Playtime no envía credenciales a servicios distintos de Steam.
