/// <reference path="./kino.d.ts" />

const API = "https://api.iwara.tv";
const FILES = "https://files.iwara.tv";
const SITE = "https://www.iwara.tv";

const X_VERSION_KEY = "mSvL05GfEmeEmsEYfGCnVpEjYgTJraJN";
const VIDEO_ID_RE = /^[a-zA-Z0-9]{8,}$/;
const USERNAME_RE = /^[a-zA-Z0-9._-]{2,40}$/;

const HEADERS = {
  Accept: "application/json, text/plain, */*",
  Origin: SITE,
  Referer: SITE + "/",
  "X-Site": "www.iwara.tv",
};

function log(...args) {
  try {
    kino.log(...args);
  } catch (_) {}
}

function cfg(key, fallback) {
  try {
    const v = kino.config.get(key);
    return v != null && v !== "" ? v : fallback;
  } catch (_) {
    return fallback;
  }
}

function hasCredentials() {
  return !!(cfg("email") && cfg("password"));
}

function tokenKey() {
  return "token:" + String(cfg("email", "")).toLowerCase();
}

function userIdKey() {
  return "userid:" + String(cfg("email", "")).toLowerCase();
}

/** Login if needed; returns Bearer token or null when no credentials. */
async function getToken() {
  if (!hasCredentials()) return null;

  const key = tokenKey();
  const saved = kino.storage.get(key);
  if (saved) return saved;

  const r = await kino.fetch(API + "/user/login", {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json" },
    body: {
      json: {
        email: cfg("email"),
        password: cfg("password"),
      },
    },
  });

  if (r.status === 401 || r.status === 400) {
    kino.storage.remove(key);
    kino.storage.remove(userIdKey());
    throw kino.error("auth_required", "usuario o contraseña incorrectos");
  }
  if (!r.ok) {
    throw kino.error("unavailable", "Iwara login respondió " + r.status);
  }

  let data;
  try {
    data = r.json();
  } catch (_) {
    throw kino.error("unavailable", "Respuesta de login inválida");
  }

  const token = data && data.token;
  if (!token) {
    throw kino.error("auth_required", "usuario o contraseña incorrectos");
  }

  kino.storage.set(key, token);

  // Cache user id from JWT payload when present
  try {
    const parts = String(token).split(".");
    if (parts.length >= 2) {
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const pad = b64.length % 4 === 0 ? b64 : b64 + "===".slice(0, 4 - (b64.length % 4));
      // atob may not exist in QuickJS; use a minimal base64 decode via kino if available, else skip
      let json = null;
      try {
        if (typeof atob === "function") {
          json = JSON.parse(atob(pad));
        }
      } catch (_) {}
      if (json) {
        const uid = json.userId || json.user_id || json.sub || json.id;
        if (uid) kino.storage.set(userIdKey(), String(uid));
      }
    }
  } catch (_) {}

  return token;
}

function authHeaders(token) {
  const h = { ...HEADERS };
  if (token) h.Authorization = "Bearer " + token;
  return h;
}

async function apiGet(path, params, { requireAuth = false } = {}) {
  let token = null;
  try {
    token = await getToken();
  } catch (e) {
    if (requireAuth) throw e;
    token = null;
  }

  if (requireAuth && !token) {
    throw kino.error("auth_required", "Configura tu cuenta de Iwara en Ajustes");
  }

  let url = API + path;
  if (params) {
    const q = Object.entries(params)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)))
      .join("&");
    if (q) url += "?" + q;
  }

  let r = await kino.fetch(url, { headers: authHeaders(token) });

  if (r.status === 401 && token && hasCredentials()) {
    kino.storage.remove(tokenKey());
    try {
      token = await getToken();
    } catch (e) {
      if (requireAuth) throw e;
      token = null;
    }
    r = await kino.fetch(url, { headers: authHeaders(token) });
  }

  if (!r.ok) {
    if (r.status === 404) throw kino.error("not_found", "No encontrado");
    if (r.status === 401 || r.status === 403) {
      throw kino.error("auth_required", "Se necesita iniciar sesión");
    }
    throw kino.error("unavailable", "Iwara respondió " + r.status);
  }
  return r.json();
}

/** Resolve logged-in user id (cached). */
async function getSelfUserId() {
  const cached = kino.storage.get(userIdKey());
  if (cached) return cached;

  if (!hasCredentials()) return null;

  // Prefer profile by username when the setting looks like a handle
  const login = String(cfg("email", "")).trim();
  if (USERNAME_RE.test(login) && !login.includes("@")) {
    try {
      const profile = await apiGet("/profile/" + encodeURIComponent(login), null, {
        requireAuth: true,
      });
      const id = profile && profile.user && profile.user.id;
      if (id) {
        kino.storage.set(userIdKey(), String(id));
        return String(id);
      }
    } catch (e) {
      log("getSelfUserId profile", e.message || e);
    }
  }

  return null;
}

function posterOf(item) {
  const file = item.file || item;
  const id = file.id || file.fileId;
  if (!id) return undefined;
  return FILES + "/image/thumbnail/" + id + "/thumbnail-00.jpg";
}

function toItem(v) {
  // Favorites API may wrap as { video: {...} }
  if (v && v.video && !v.id) v = v.video;
  if (!v || !v.id) return null;
  const user = v.user || {};
  const year = v.createdAt ? String(v.createdAt).slice(0, 4) : undefined;
  const badges = [];
  if (user.name) badges.push(String(user.name).slice(0, 40));
  if (v.file && v.file.height) badges.push(String(v.file.height) + "p");
  return {
    id: v.id,
    ref: v.id,
    title: String(v.title || v.id).slice(0, 200),
    kind: "movie",
    year,
    poster: posterOf(v),
    overview: v.body ? String(v.body).replace(/<[^>]+>/g, "").slice(0, 400) : undefined,
    adult: v.rating === "ecchi",
    badges: badges.length ? badges : undefined,
  };
}

function pageCursor(page) {
  return String(page + 1);
}

async function listVideos(params) {
  const data = await apiGet("/videos", {
    rating: "all",
    limit: 20,
    page: 0,
    ...params,
  });
  return (data.results || []).map(toItem).filter(Boolean);
}

async function resolveUserId(username) {
  const profile = await apiGet("/profile/" + encodeURIComponent(username));
  const user = profile && profile.user;
  if (!user || !user.id) return null;
  return { id: user.id, name: user.name || username, username: user.username || username };
}

async function videosByUser(userId, page, limit) {
  const data = await apiGet("/videos", {
    user: userId,
    sort: "date",
    rating: "all",
    page,
    limit,
  });
  const results = data.results || [];
  const items = results.map(toItem).filter(Boolean);
  const next = results.length >= limit ? pageCursor(page) : undefined;
  return next ? { items, next } : items;
}

/** Favorites of the logged-in account. */
async function listFavorites(page, limit) {
  const data = await apiGet(
    "/favorites/videos",
    { page, limit },
    { requireAuth: true }
  );
  const results = data.results || [];
  const items = results.map(toItem).filter(Boolean);
  const next = results.length >= limit ? pageCursor(page) : undefined;
  return next ? { items, next } : items;
}

/** Playlists of a user. */
async function listPlaylists(userId, page, limit) {
  const data = await apiGet(
    "/playlists",
    { user: userId, page, limit },
    { requireAuth: true }
  );
  return data.results || [];
}

/** Videos inside a playlist. */
async function listPlaylistVideos(playlistId, page, limit) {
  const data = await apiGet(
    "/playlist/" + encodeURIComponent(playlistId),
    { page, limit },
    { requireAuth: false }
  );
  const results = data.results || [];
  const items = results.map(toItem).filter(Boolean);
  const next = results.length >= limit ? pageCursor(page) : undefined;
  return next ? { items, next } : items;
}

function parseQuery(raw) {
  const q = String(raw || "").trim();
  if (!q) return { mode: "empty" };

  let m = q.match(/iwara\.(?:tv|ai)\/video\/([a-zA-Z0-9]+)/i);
  if (m) return { mode: "video", id: m[1] };

  m = q.match(/iwara\.(?:tv|ai)\/profile\/([a-zA-Z0-9._-]+)/i);
  if (m) return { mode: "user", username: m[1] };

  m = q.match(/iwara\.(?:tv|ai)\/playlist\/([a-zA-Z0-9]+)/i);
  if (m) return { mode: "playlist", id: m[1] };

  m = q.match(/^(?:user|artist|author|uploader)\s*:\s*(.+)$/i);
  if (m) return { mode: "user", username: m[1].trim() };
  if (q.startsWith("@")) {
    const u = q.slice(1).trim();
    if (u) return { mode: "user", username: u };
  }

  m = q.match(/^tag\s*:\s*(.+)$/i);
  if (m) return { mode: "tag", tag: m[1].trim().replace(/\s+/g, "_").toLowerCase() };
  if (q.startsWith("#")) {
    const tag = q
      .slice(1)
      .trim()
      .split(/[\s#,]+/)
      .filter(Boolean)
      .map((t) => t.toLowerCase())
      .join(",");
    if (tag) return { mode: "tag", tag };
  }

  if (VIDEO_ID_RE.test(q) && !q.includes(" ")) {
    return { mode: "video", id: q };
  }

  if (USERNAME_RE.test(q) && !q.includes(" ")) {
    return { mode: "maybe_user", username: q, fallback: q };
  }

  return { mode: "search", query: q };
}

// ---- settings UI (apiVersion 6) ------------------------------------------

export async function settingsStatus() {
  if (!hasCredentials()) {
    return { linked: "Sin cuenta (catálogo público)" };
  }
  try {
    const token = await getToken();
    if (token) {
      return { linked: "Sesión activa · " + String(cfg("email")).slice(0, 40) };
    }
  } catch (e) {
    return { linked: "Error: " + (e.message || "no se pudo iniciar sesión") };
  }
  return { linked: "Sin sesión" };
}

export async function action(key) {
  if (key === "logout") {
    try {
      kino.storage.remove(tokenKey());
      kino.storage.remove(userIdKey());
    } catch (_) {}
    return {
      message: "Sesión cerrada",
      clearSettings: ["email", "password"],
    };
  }
  return { message: "Listo" };
}

// ---- search / home / browse / resolve ------------------------------------

export async function search(query) {
  const raw = (query.q || "").trim();
  if (!raw) return [];

  const page = query.cursor ? parseInt(query.cursor, 10) || 0 : 0;
  const limit = 24;
  const sort = cfg("sort", "relevance");
  const parsed = parseQuery(raw);

  if (parsed.mode === "playlist") {
    return listPlaylistVideos(parsed.id, page, limit);
  }

  if (parsed.mode === "video" && page === 0) {
    try {
      const video = await apiGet("/video/" + encodeURIComponent(parsed.id));
      if (video && video.id && !video.message) {
        const item = toItem(video);
        return item ? [item] : [];
      }
    } catch (_) {}
  }

  if (parsed.mode === "user" || parsed.mode === "maybe_user") {
    try {
      const user = await resolveUserId(parsed.username);
      if (user) {
        const result = await videosByUser(user.id, page, limit);
        if (Array.isArray(result) ? result.length : result.items.length) {
          return result;
        }
      }
    } catch (e) {
      log("user search", parsed.username, e.message || e);
    }
    if (parsed.mode === "user") {
      return page === 0 ? [] : { items: [], next: undefined };
    }
  }

  if (parsed.mode === "tag") {
    const data = await apiGet("/videos", {
      tags: parsed.tag,
      sort: sort === "relevance" ? "trending" : sort,
      rating: "all",
      page,
      limit,
    });
    const results = data.results || [];
    const items = results.map(toItem).filter(Boolean);
    const next = results.length >= limit ? pageCursor(page) : undefined;
    return next ? { items, next } : items;
  }

  const searchQuery =
    parsed.mode === "search"
      ? parsed.query
      : parsed.mode === "maybe_user"
        ? parsed.fallback
        : raw;

  const data = await apiGet("/search", {
    type: "videos",
    query: searchQuery,
    sort:
      sort === "relevance" || sort === "date" || sort === "views" || sort === "likes"
        ? sort
        : "relevance",
    page,
    limit,
  });

  const results = data.results || [];
  const items = results.map(toItem).filter(Boolean);
  const next = results.length >= limit ? pageCursor(page) : undefined;
  return next ? { items, next } : items;
}

export async function home() {
  const rows = [];

  if (hasCredentials()) {
    // Suscripciones
    try {
      const items = await listVideos({ sort: "date", subscribed: "true" });
      if (items.length) {
        rows.push({
          id: "subscribed",
          title: "Tus suscripciones",
          items,
          ref: "subscribed",
        });
      }
    } catch (e) {
      log("home subscribed", e.message || e);
    }

    // Favoritos
    try {
      const fav = await listFavorites(0, 20);
      const items = Array.isArray(fav) ? fav : fav.items || [];
      if (items.length) {
        rows.push({
          id: "favorites",
          title: "Tus favoritos",
          items,
          ref: "favorites",
        });
      }
    } catch (e) {
      log("home favorites", e.message || e);
    }

    // Playlists propias (hasta 4 filas)
    try {
      const uid = await getSelfUserId();
      if (uid) {
        const playlists = await listPlaylists(uid, 0, 8);
        for (const pl of playlists.slice(0, 4)) {
          if (!pl || !pl.id) continue;
          try {
            const vids = await listPlaylistVideos(pl.id, 0, 16);
            const items = Array.isArray(vids) ? vids : vids.items || [];
            if (items.length) {
              rows.push({
                id: "playlist-" + pl.id,
                title: String(pl.title || pl.name || "Playlist").slice(0, 60),
                items,
                ref: "playlist:" + pl.id,
              });
            }
          } catch (e) {
            log("home playlist", pl.id, e.message || e);
          }
        }
      }
    } catch (e) {
      log("home playlists", e.message || e);
    }
  }

  const sorts = [
    { id: "trending", title: "Tendencias", sort: "trending" },
    { id: "date", title: "Más recientes", sort: "date" },
    { id: "popularity", title: "Populares", sort: "popularity" },
  ];

  for (const s of sorts) {
    try {
      const items = await listVideos({ sort: s.sort });
      if (items.length) {
        rows.push({
          id: s.id,
          title: s.title,
          items,
          ref: "sort:" + s.sort,
        });
      }
    } catch (e) {
      log("home sort", s.id, e.message || e);
    }
  }

  return rows;
}

export async function browse(ref, cursor) {
  const page = cursor ? parseInt(cursor, 10) || 0 : 0;
  const limit = 24;

  if (ref === "favorites") {
    return listFavorites(page, limit);
  }

  if (ref === "subscribed") {
    const data = await apiGet(
      "/videos",
      { subscribed: "true", sort: "date", rating: "all", page, limit },
      { requireAuth: true }
    );
    const results = data.results || [];
    const items = results.map(toItem).filter(Boolean);
    const next = results.length >= limit ? pageCursor(page) : undefined;
    return next ? { items, next } : items;
  }

  if (ref && ref.startsWith("playlist:")) {
    return listPlaylistVideos(ref.slice(9), page, limit);
  }

  const params = {
    rating: "all",
    page,
    limit,
  };

  if (ref && ref.startsWith("sort:")) {
    params.sort = ref.slice(5);
  } else if (ref && ref.startsWith("user:")) {
    params.user = ref.slice(5);
    params.sort = "date";
  } else if (ref && ref.startsWith("tag:")) {
    params.tags = ref.slice(4);
    params.sort = "trending";
  } else {
    params.sort = "date";
  }

  const data = await apiGet("/videos", params);
  const results = data.results || [];
  const items = results.map(toItem).filter(Boolean);
  const next = results.length >= limit ? pageCursor(page) : undefined;
  return next ? { items, next } : items;
}

export async function resolve(ref) {
  const videoId = String(ref || "").trim();
  if (!videoId) throw kino.error("not_found", "ID vacío");

  const video = await apiGet("/video/" + encodeURIComponent(videoId), null, {
    requireAuth: false,
  });

  if (video.message === "errors.privateVideo") {
    if (!hasCredentials()) {
      throw kino.error(
        "auth_required",
        "Vídeo privado: configura tu cuenta de Iwara en Ajustes"
      );
    }
    throw kino.error("auth_required", "Vídeo privado o sin permiso");
  }
  if (video.message === "errors.notFound") {
    throw kino.error("not_found", "Vídeo no encontrado");
  }
  if (video.message) {
    throw kino.error("unavailable", video.message);
  }

  if (video.embedUrl && !video.fileUrl) {
    throw kino.error("unavailable", "Este vídeo es un enlace externo");
  }

  const fileUrl = video.fileUrl;
  if (!fileUrl) {
    throw kino.error("unavailable", "Sin archivo de vídeo");
  }

  let fileId = "";
  let expires = "";
  try {
    const u = new URL(fileUrl.startsWith("//") ? "https:" + fileUrl : fileUrl);
    const parts = u.pathname.replace(/\/+$/, "").split("/");
    fileId = parts[parts.length - 1] || "";
    expires = u.searchParams.get("expires") || "";
  } catch (_) {
    throw kino.error("unavailable", "URL de archivo inválida");
  }

  if (!fileId || !expires) {
    throw kino.error("unavailable", "No se pudo firmar la petición");
  }

  const xVersion = kino.crypto.hash(
    "sha1",
    fileId + "_" + expires + "_" + X_VERSION_KEY
  );

  let token = null;
  try {
    token = await getToken();
  } catch (_) {
    token = null;
  }

  const sourcesRes = await kino.fetch(fileUrl, {
    headers: {
      ...authHeaders(token),
      "X-Version": xVersion,
    },
  });

  if (!sourcesRes.ok) {
    throw kino.error(
      "unavailable",
      "No se obtuvieron fuentes (" + sourcesRes.status + ")"
    );
  }

  let sources;
  try {
    sources = sourcesRes.json();
  } catch (_) {
    throw kino.error("unavailable", "Respuesta de fuentes inválida");
  }

  if (!Array.isArray(sources) || !sources.length) {
    throw kino.error("unavailable", "Sin calidades disponibles");
  }

  const preferred = String(cfg("quality", "source")).toLowerCase();
  const rank = { source: 4, "540": 3, "360": 2, preview: 1 };
  const preferredRank = rank[preferred] || 4;

  sources.sort((a, b) => {
    const ra = rank[String(a.name || "").toLowerCase()] || 0;
    const rb = rank[String(b.name || "").toLowerCase()] || 0;
    return rb - ra;
  });

  let best =
    sources.find((s) => String(s.name || "").toLowerCase() === preferred) ||
    sources.find((s) => {
      const r = rank[String(s.name || "").toLowerCase()] || 0;
      return r > 0 && r <= preferredRank && s.src && (s.src.view || s.src.download);
    }) ||
    sources.find((s) => s.src && (s.src.view || s.src.download));

  if (!best) throw kino.error("unavailable", "Sin URL de reproducción");

  let playUrl = best.src.download || best.src.view;
  if (playUrl.startsWith("//")) playUrl = "https:" + playUrl;
  if (!playUrl.startsWith("http")) playUrl = "https://" + playUrl.replace(/^\/+/, "");

  const alternatives = [];
  for (const s of sources) {
    if (s === best) continue;
    const u = (s.src && (s.src.download || s.src.view)) || null;
    if (!u) continue;
    let url = u.startsWith("//") ? "https:" + u : u;
    if (!url.startsWith("http")) url = "https://" + url.replace(/^\/+/, "");
    alternatives.push({
      url,
      label: s.name || "otra calidad",
      mime: "video/mp4",
    });
  }

  return {
    url: playUrl,
    mime: "video/mp4",
    label: best.name || "Source",
    headers: {
      Referer: SITE + "/",
      Origin: SITE,
    },
    alternatives: alternatives.length ? alternatives : undefined,
    expiresInSeconds: 3600,
  };
}
