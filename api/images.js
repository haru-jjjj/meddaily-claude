// Vercel Serverless Function: GET /api/images?q=<english search phrase>
// Searches NLM Open-i (open-access biomedical images, incl. MedPix) first,
// then falls back to Wikimedia Commons. No API keys needed for either.

const OPENI_BASE = "https://openi.nlm.nih.gov";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const TIMEOUT_MS = 8000;
const MAX_RESULTS = 4;

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function absolute(url) {
  if (!url || typeof url !== "string") return "";
  if (url.startsWith("http")) return url;
  return OPENI_BASE + (url.startsWith("/") ? url : "/" + url);
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "MedDaily/1.0 (personal study app)" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function searchOpenI(q) {
  const url = `${OPENI_BASE}/api/search?query=${encodeURIComponent(q)}&m=1&n=8`;
  const data = await fetchJson(url);
  const list = Array.isArray(data && data.list) ? data.list : [];
  return list
    .map((item) => {
      const thumb = absolute(item.imgThumbLarge || item.imgThumb || item.imgLarge);
      const full = absolute(item.imgLarge || item.imgThumbLarge || item.imgThumb);
      if (!thumb || !full) return null;
      const caption = stripHtml((item.image && item.image.caption) || item.caption || "");
      const pmcid = item.pmcid || "";
      const sourceUrl = pmcid
        ? `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`
        : absolute(item.detailedQueryURL || "") || OPENI_BASE;
      return {
        thumb,
        full,
        caption: caption.slice(0, 400),
        sourceTitle: stripHtml(item.title || item.journal_title || "Open-i"),
        sourceUrl,
        license: stripHtml(item.licenseType || item.license || ""),
        provider: "Open-i"
      };
    })
    .filter(Boolean);
}

async function searchCommons(q) {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${q} filetype:bitmap`,
    gsrlimit: "8",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "640",
    format: "json",
    origin: "*"
  });
  const data = await fetchJson(`${COMMONS_API}?${params.toString()}`);
  const pages = data && data.query && data.query.pages ? Object.values(data.query.pages) : [];
  pages.sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages
    .map((p) => {
      const info = p.imageinfo && p.imageinfo[0];
      if (!info || !info.url) return null;
      const meta = info.extmetadata || {};
      const desc = stripHtml(meta.ImageDescription && meta.ImageDescription.value);
      const title = String(p.title || "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
      return {
        thumb: info.thumburl || info.url,
        full: info.thumburl || info.url,
        caption: (desc || title).slice(0, 400),
        sourceTitle: title,
        sourceUrl: info.descriptionurl || "https://commons.wikimedia.org",
        license: stripHtml(meta.LicenseShortName && meta.LicenseShortName.value),
        provider: "Wikimedia Commons"
      };
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  const q = String((req.query && req.query.q) || "").trim().slice(0, 200);
  if (!q) {
    res.status(400).json({ error: "missing q" });
    return;
  }

  let images = [];
  try {
    images = await searchOpenI(q);
  } catch (e) {
    console.warn("Open-i failed:", e && e.message);
  }

  if (images.length < 2) {
    try {
      images = images.concat(await searchCommons(q));
    } catch (e) {
      console.warn("Commons failed:", e && e.message);
    }
  }

  res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
  res.status(200).json({ images: images.slice(0, MAX_RESULTS) });
}
