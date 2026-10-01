# PR Radar

PR Radar es una app de barra de menú para macOS (también funciona en Windows y Linux). Cada 30 segundos consulta GitHub, te avisa cuando alguien te pide revisar un pull request y te muestra la lista de reviews pendientes.

- Icono en la barra de menú con el número de reviews pendientes. No aparece en el Dock.
- Notificación nativa cuando te asignan una review, a ti o a uno de tus equipos. Al hacer clic se abre el PR.
- Panel con los PRs, los más recientes primero: repo, autor, tamaño del diff, Draft y si la review es directa o de equipo.
- Login con GitHub mediante Device Flow. El token se guarda cifrado en el Llavero de macOS.

## 1. Crea la OAuth App (una sola vez)

1. Ve a GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App** (<https://github.com/settings/applications/new>).
2. Rellena:
   - **Application name:** `PR Radar`
   - **Homepage URL:** `http://localhost`
   - **Authorization callback URL:** `http://localhost` (el Device Flow no lo usa).
3. Pulsa **Register application**, marca **Enable Device Flow** y guarda.
4. Copia el **Client ID**. No es secreto y no hace falta generar un client secret.

Tienes dos formas de configurarlo:

- **Al compilar** (recomendado): `cp .env.example .env` y pon el Client ID en `MAIN_VITE_GITHUB_CLIENT_ID`.
- **En la app:** si no hay Client ID, la pantalla de inicio te pide pegarlo.

> **Organizaciones con restricciones:** si tu organización limita las OAuth Apps, al autorizar verás la org con un botón **Request** o **Grant**. Hasta que un admin la apruebe, los PRs de esa org no aparecerán. Si la org usa **SAML SSO**, autoriza también el SSO; si falta, la app muestra un aviso.

## 2. Desarrollo

```bash
npm install
npm run dev          # abre la app con recarga en caliente
npm test             # tests unitarios (vitest)
npm run typecheck
npm run icons        # regenera los iconos de resources/ y build/
```

## 3. Empaquetar

```bash
npm run dist:mac     # dist/PR Radar-<versión>-universal.dmg (Apple Silicon + Intel)
npm run dist:win     # instalador NSIS
npm run dist:linux   # AppImage
```

La app no está firmada con un certificado de Apple. La primera vez que la abras, haz **clic derecho → Abrir** o ve a *Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente*.

## Uso

- **Clic** en el icono: abre o cierra el panel.
- **Clic derecho:** Actualizar ahora · Abrir al iniciar sesión · Cerrar sesión · Salir.
- **Ajustes** (engranaje del panel):
  - Incluir solicitudes a equipos.
  - Mostrar drafts.
  - Notificaciones.
  - Intervalo de consulta (30 s por defecto).
  - Probar notificación: la primera vez, macOS pide permiso.

### Cómo decide qué notificar

- La primera vez que te conectas recibes un único resumen ("Tienes N PRs pendientes").
- Después, cada PR nuevo genera una notificación. Si llegan más de 3 a la vez, se agrupan en una.
- Si reviewas un PR y te vuelven a pedir review, vuelve a avisarte.
- También avisa de los PRs que llegaron mientras la app estaba cerrada.
- Al despertar el Mac consulta de inmediato.

Cada consulta es una sola query GraphQL de 1 punto: unos 120 puntos por hora, frente a un límite de 5000.

## Estructura

```
src/main/       proceso principal: tray, panel, poller, GitHub, Device Flow, notificaciones
src/preload/    puente IPC tipado (window.prRadar)
src/renderer/   UI en React
src/shared/     tipos compartidos
tests/          tests unitarios
```

Los datos se guardan en `~/Library/Application Support/PR Radar/`:

- `auth.bin`: token cifrado.
- `settings.json`: ajustes.
- `state.json`: PRs ya vistos.
