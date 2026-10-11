import { MedicalImage } from "../types";

const MAX_TOTAL = 6;

/**
 * Fallback used when /api/images isn't available (e.g. plain `npm run dev`
 * without Vercel). Wikimedia Commons allows browser calls with origin=*.
 */
async function searchCommonsDirect(q: string): Promise<MedicalImage[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `${q} filetype:bitmap`,
    gsrlimit: "6",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "640",
    format: "json",
    origin: "*"
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  const pages: any[] = data?.query?.pages ? Object.values(data.query.pages) : [];
  pages.sort((a, b) => (a.index || 0) - (b.index || 0));
  const strip = (s: string) => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return pages
    .map((p): MedicalImage | null => {
      const info = p.imageinfo?.[0];
      if (!info?.url) return null;
      const meta = info.extmetadata || {};
      const title = String(p.title || "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
      return {
        thumb: info.thumburl || info.url,
        full: info.thumburl || info.url,
        caption: (strip(meta.ImageDescription?.value) || title).slice(0, 400),
        sourceTitle: title,
        sourceUrl: info.descriptionurl || "https://commons.wikimedia.org",
        license: strip(meta.LicenseShortName?.value),
        provider: "Wikimedia Commons"
      };
    })
    .filter((x): x is MedicalImage => x !== null)
    .slice(0, 4);
}

async function searchOne(q: string): Promise<MedicalImage[]> {
  try {
    const res = await fetch(`/api/images?q=${encodeURIComponent(q)}`);
    const type = res.headers.get("content-type") || "";
    if (res.ok && type.includes("application/json")) {
      const data = await res.json();
      if (Array.isArray(data.images)) return data.images;
    }
  } catch (e) {
    // fall through to direct Commons search
  }
  try {
    return await searchCommonsDirect(q);
  } catch (e) {
    return [];
  }
}

/**
 * Runs each query (in parallel) and merges results, de-duplicating by image URL.
 */
export async function fetchMedicalImages(queries: string[]): Promise<MedicalImage[]> {
  const clean = queries.map(q => q.trim()).filter(Boolean).slice(0, 3);
  if (clean.length === 0) return [];
  const results = await Promise.all(clean.map(searchOne));
  const seen = new Set<string>();
  const merged: MedicalImage[] = [];
  // interleave so each query contributes its best hit first
  const maxLen = Math.max(...results.map(r => r.length), 0);
  for (let i = 0; i < maxLen && merged.length < MAX_TOTAL; i++) {
    for (const list of results) {
      const img = list[i];
      if (img && !seen.has(img.full) && merged.length < MAX_TOTAL) {
        seen.add(img.full);
        merged.push(img);
      }
    }
  }
  return merged;
}
