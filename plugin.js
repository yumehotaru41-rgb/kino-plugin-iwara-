/// <reference path="./kino.d.ts" />

const API = "https://api.iwara.tv";
const FILES = "https://files.iwara.tv";
const SITE = "https://www.iwara.tv";

const X_VERSION_KEY = "mSvL05GfEmeEmsEYfGCnVpEjYgTJraJN";
const VIDEO_ID_RE = /^[a-zA-Z0-9]{8,}$/;

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

async function apiGet(path, params) {
  let url = API + path;
  if (params) {
    const q = Object.entries(params)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)))
      .join("&");
    if (q) url += "?" + q;
  }
  const r = await kino.fetch(url, { headers: HEADERS });
  if (!r.ok) {
    if (r.status === 404) throw kino.error("not_found", "No encontrado");
    if (r.status === 403) throw kino.error("auth_required", "Se necesita iniciar sesión");
    throw kino.error("unavailable", "Iwara respondió " + r.status);
  }
  return r.json();
}

function posterOf(item) {
  const file = item.file || item;
  const id = file.id || file.fileId;
  if (!id) return undefined;
  return FILES + "/image/thumbnail/" + id + "/thumbnail-00.jpg";
}

function toItem(v) {
  if (!v || !v.id) return null;
  const user = v.user || {};
  const year = v.createdAt ? String(v.createdAt).slice(0, 4) : undefined;
  return {
    id: v.id,
    ref: v.id,
    title: String(v.title || v.id).slice(0, 200),
    kind: "movie",
    year,
    poster: posterOf(v),
    overview: v.body ? String(v.body).replace(/<[^>]+>/g, "").slice(0, 400) : undefined,
    adult: v.rating === "ecchi",
    badges: user.name ? [String(user.name).slice(0, 40)] : undefined,
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

export async function search(query) {
  const raw = (query.q || "").trim();
  if (!raw) return [];

  const page = query.cursor ? parseInt(query.cursor, 10) || 0 : 0;
  const limit = 24;

  let maybeId = raw;
  const urlMatch = raw.match(/iwara\.(?:tv|ai)\/video\/([a-zA-Z0-9]+)/i);
  if (urlMatch) maybeId = urlMatch[1];

  if (VIDEO_ID_RE.test(maybeId) && !raw.includes(" ") && page === 0) {
    try {
      const video = await apiGet("/video/" + encodeURIComponent(maybeId));
      if (video && video.id && !video.message) {
        const item = toItem(video);
        return item ? [item] : [];
      }
    } catch (_) {}
  }

  let tag = null;
  if (raw.toLowerCase().startsWith("tag:")) {
    tag = raw.slice(4).trim();
  } else if (raw.startsWith("#")) {
    tag = raw.slice(1).trim();
  }

  if (tag) {
    const data = await apiGet("/videos", {
      tags: tag.replace(/\s+/g, "_").toLowerCase(),
      sort: "trending",
      rating: "all",
      page,
      limit,
    });
    const results = data.results || [];
    const items = results.map(toItem).filter(Boolean);
    const next = results.length >= limit ? pageCursor(page) : undefined;
    return next ? { items, next } : items;
  }

  const data = await apiGet("/search", {
    type: "videos",
    query: raw,
    sort: "relevance",
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
  const params = {
    rating: "all",
    page,
    limit: 24,
  };

  if (ref && ref.startsWith("sort:")) {
    params.sort = ref.slice(5);
  } else {
    params.sort = "date";
  }

  const data = await apiGet("/videos", params);
  const results = data.results || [];
  const items = results.map(toItem).filter(Boolean);
  const next = results.length >= 24 ? pageCursor(page) : undefined;
  return { items, next };
}

export async function resolve(ref) {
  const videoId = String(ref || "").trim();
  if (!videoId) throw kino.error("not_found", "ID vacío");

  const video = await apiGet("/video/" + encodeURIComponent(videoId));

  if (video.message === "errors.privateVideo") {
    throw kino.error("auth_required", "Vídeo privado");
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

  const sourcesRes = await kino.fetch(fileUrl, {
    headers: {
      ...HEADERS,
      "X-Version": xVersion,
    },
  });

  if (!sourcesRes.ok) {
    throw kino.error("unavailable", "No se obtuvieron fuentes (" + sourcesRes.status + ")");
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

  const rank = { Source: 4, "540": 3, "360": 2, preview: 1 };
  sources.sort((a, b) => (rank[b.name] || 0) - (rank[a.name] || 0));

  const best = sources.find((s) => s.src && (s.src.view || s.src.download));
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
