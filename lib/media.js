// Pairing character JSON exports with their token art, and standing in
// with generated art when there isn't any.
//
// The convention: an image sitting beside a character file with the same
// name - dire-wolf.json next to dire-wolf.png - belongs to it. Absorbed
// from the Bestiary extension, which this replaced.
//
// Browsers can't read a folder on their own, only files a person hands
// over, so "beside it" means the image came in with the JSON: multi-selected
// in one dialog, picked as a folder, or dropped together. All three arrive
// here as the same flat FileList.
//
// Needs a DOM for the canvas work, so unlike combat/model.js this is
// browser-only.

const IMAGE_RE = /\.(png|jpe?g|webp|gif|svg)$/i;
const JSON_RE = /\.json$/i;

// Big enough to serve as real token art on a scene, small enough that a
// roster of them fits in localStorage. Originals go untouched into a data
// URL otherwise, and a handful of 4000px photos would blow the quota.
const MAX_EDGE = 512;

export function baseName(filename) {
  return String(filename).replace(/\.[^.]+$/, '').toLowerCase();
}

export function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode image'));
    img.src = url;
  });
}

// Scales an image down to fit MAX_EDGE, preserving aspect ratio, and
// re-encodes it. Anything already smaller is passed through untouched
// rather than re-encoded, which would only lose quality.
//
// SVG is passed through as-is: it's already small, and rasterising it
// would throw away the one format that scales cleanly.
export async function downscale(dataUrl, maxEdge = MAX_EDGE) {
  if (/^data:image\/svg\+xml/i.test(dataUrl)) return dataUrl;
  let img;
  try {
    img = await loadImage(dataUrl);
  } catch {
    return dataUrl; // undecodable - keep the original rather than losing it
  }
  const { naturalWidth: w, naturalHeight: h } = img;
  if (!w || !h) return dataUrl;
  if (w <= maxEdge && h <= maxEdge) return dataUrl;

  const scale = maxEdge / Math.max(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // WebP is markedly smaller; browsers that don't produce it fall back to
  // PNG on their own by returning a data:image/png URL from toDataURL.
  return canvas.toDataURL('image/webp', 0.85);
}

// Natural pixel dimensions of an image, used to size a scene token.
// Falls back to a square if it can't be decoded, which is better than
// refusing to place the token at all.
export async function imageSize(dataUrl, fallback = 512) {
  try {
    const img = await loadImage(dataUrl);
    return { w: img.naturalWidth || fallback, h: img.naturalHeight || fallback };
  } catch {
    return { w: fallback, h: fallback };
  }
}

// The mime type declared in a data URL. Scene tokens carry this alongside
// the image, and our art is usually WebP rather than the PNG a hardcoded
// value would claim.
export function mimeOf(dataUrl, fallback = 'image/png') {
  const m = /^data:([^;,]+)/i.exec(String(dataUrl));
  return m ? m[1] : fallback;
}

// ---- Generated stand-in art ----

export function colorForName(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360}, 60%, 52%)`;
}

export function initialsForName(name) {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

// A colored ring with the character's initials. The color is hashed from
// the name, so four wolves in one fight are still told apart at a glance,
// and the same creature looks the same every session.
export function makePlaceholder(name, size = 512) {
  const color = colorForName(name);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const unit = size / 512;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 14 * unit, 0, Math.PI * 2);
  ctx.fillStyle = '#0e1c26';
  ctx.fill();
  ctx.lineWidth = 16 * unit;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = `bold ${190 * unit}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initialsForName(name), size / 2, size / 2 + 16 * unit);
  return canvas.toDataURL('image/png');
}

// ---- Pairing ----

// Takes whatever files arrived and returns one entry per JSON, each with
// its matching image if one came along. Images with no matching JSON are
// ignored rather than treated as an error - selecting a whole folder will
// routinely sweep up art for characters that weren't chosen.
export async function pairFiles(fileList) {
  const files = [...fileList];
  const jsonFiles = files.filter((f) => JSON_RE.test(f.name));
  const imagesByBase = new Map(
    files.filter((f) => IMAGE_RE.test(f.name)).map((f) => [baseName(f.name), f]),
  );

  const out = [];
  for (const jf of jsonFiles) {
    const match = imagesByBase.get(baseName(jf.name));
    let icon = null;
    if (match) {
      try {
        icon = await downscale(await readAsDataUrl(match));
      } catch {
        icon = null; // unreadable art shouldn't cost you the character
      }
    }
    out.push({
      filename: jf.name,
      text: await readAsText(jf),
      icon,
      iconName: match ? match.name : null,
    });
  }
  return out;
}
