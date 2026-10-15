# Kino plugin: Iwara

Plugin de [Kino](https://kinotvapp.github.io/) para buscar y reproducir vídeos de [iwara.tv](https://www.iwara.tv/).

**Contenido solo para adultos (+18) en buena parte del catálogo.**

## Qué hace

| Capacidad | Descripción |
| --- | --- |
| **search** | Búsqueda por título, artista, tag, ID o URL |
| **home** | Filas de tendencias, recientes y populares; con sesión: suscripciones, favoritos y playlists |
| **browse** | «Ver más» de cada fila del Inicio |
| **resolve** | Obtiene la URL del stream respetando la calidad preferida |

## Búsqueda

| Qué escribes | Qué busca |
| --- | --- |
| Texto libre | Título y descripción |
| `tag:miku` o `#miku` | Vídeos con ese tag |
| `user:nombre`, `artist:nombre` o `@nombre` | Vídeos de ese artista |
| URL de vídeo (`iwara.tv/video/…`) | Ese vídeo |
| URL de perfil (`iwara.tv/profile/…`) | Vídeos del usuario |
| URL de playlist (`iwara.tv/playlist/…`) | Vídeos de la playlist |
| ID alfanumérico | Intenta abrir ese vídeo |

## Ajustes (Configurar / pestaña Iwara)

### Cuenta (opcional)

Sin cuenta ves el catálogo público. Con correo/usuario y contraseña de iwara.tv:

- Vídeos privados (si tu cuenta tiene acceso)
- Fila **Tus suscripciones** en Inicio
- Fila **Tus favoritos** en Inicio
- Hasta 4 filas con tus **playlists**

| Campo | Uso |
| --- | --- |
| Correo o usuario | El mismo con el que entras en iwara.tv |
| Contraseña | Guardada cifrada en el aparato |
| Estado de la sesión | Indica si hay sesión activa |
| Cerrar sesión | Borra el token y limpia usuario/contraseña |

Para que aparezcan las playlists, conviene poner el **nombre de usuario** (no solo el correo).

### Reproducción

| Ajuste | Opciones |
| --- | --- |
| **Calidad de vídeo** | Source (máxima) · 540p · 360p (ahorro de datos) |
| **Orden de búsqueda** | Relevancia · Más recientes · Más vistos · Más valorados |

## Instalación en Kino

1. Publica este repositorio en GitHub como **público**.
2. (Opcional) Añade el topic `kino-plugin` en About → Topics.
3. En Kino: **Ajustes → Plugins → Agregar** y escribe:

```text
yumehotaru41-rgb/kino-plugin-iwara-
```

O pega la URL del repositorio / del `kino-plugin.json`.

## Archivos

```text
kino-plugin.json   manifiesto
plugin.js          código
icon.png           ícono (128×128)
README.md          este archivo
```

## Notas

- El plugin no aloja contenido: solo habla con la API pública de Iwara (`api.iwara.tv`, `files.iwara.tv`, etc.).
- La sesión es opcional; el token se guarda en el almacenamiento del plugin en el aparato.
- No hay capacidad de descarga offline: la reproducción es en streaming.
- Versión del contrato: `apiVersion` 6 (Kino 0.9.50+).

## Licencia

Uso libre a criterio de quien mantenga el repositorio. Iwara y su contenido pertenecen a sus respectivos autores y a la plataforma.
