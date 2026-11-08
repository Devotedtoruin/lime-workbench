// Device-local media only. No SVGs, external URLs, uploads, or user-record writes.
import { isRasterDataUrl, MAX_BACKGROUND_IMAGE_CHARS } from './appearance.js';

export const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_AVATAR_IMAGE_CHARS = 300_000;
const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
const MiB = 1024 * 1024;
const limits = { avatar: { bytes: 2 * MiB, edge: 1024, frames: 300 }, background: { bytes: 8 * MiB, edge: 4096, frames: 200 } };
const MAX_ANIMATION_PIXELS = 100_000_000;

/** Legacy static-image metadata validation, preserved for existing callers. */
export function validateImageFile(file) {
  if (!file || typeof file !== 'object' || !allowedTypes.includes(file.type)) {
    return { ok: false, error: '请选择本地 PNG、JPEG 或 WebP 图片，不支持 SVG 和外链' };
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_IMAGE_FILE_BYTES) {
    return { ok: false, error: '图片必须大于 0 字节且不超过 10 MB' };
  }
  return { ok: true };
}

async function checkSignature(file) {
  if (typeof file.slice !== 'function') throw new Error('无法读取这个本地图片文件');
  const chunk = file.slice(0, 12);
  if (typeof chunk.arrayBuffer !== 'function') throw new Error('浏览器不支持安全读取图片');
  const bytes = new Uint8Array(await chunk.arrayBuffer());
  let valid = false;
  if (file.type === 'image/png') valid = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
  else if (file.type === 'image/jpeg') valid = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  else if (file.type === 'image/webp') valid = ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
  if (!valid) throw new Error('图片内容与格式不匹配，请选择真实的 PNG、JPEG 或 WebP 文件');
}

function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const image = new globalThis.Image();
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      if (error) { image.src = ''; reject(error); } else resolve(image);
    };
    const timer = setTimeout(() => finish(new Error('图片解码超时，请换一张图片')), 15_000);
    image.onload = () => finish();
    image.onerror = () => finish(new Error('图片无法解码，请换一张图片'));
    try { image.src = url; } catch { finish(new Error('图片无法解码，请换一张图片')); }
  });
}

function encode(canvas, type, quality, max) {
  const result = canvas.toDataURL(type, quality);
  return isRasterDataUrl(result, max) && result.startsWith(`data:${type};base64,`) ? result : null;
}

function posterFor(image, width, height, kind) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context || typeof canvas.toDataURL !== 'function') throw new Error('浏览器无法压缩图片');
  if (kind === 'avatar') {
    canvas.width = canvas.height = 256;
    const side = Math.min(width, height);
    context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 256, 256);
    const png = encode(canvas, 'image/png', undefined, MAX_AVATAR_IMAGE_CHARS);
    if (png) return png;
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 256, 256);
    context.globalCompositeOperation = 'source-over';
    for (const quality of [0.9, 0.8, 0.65, 0.5, 0.35]) {
      const result = encode(canvas, 'image/jpeg', quality, MAX_AVATAR_IMAGE_CHARS);
      if (result) return result;
    }
    throw new Error('头像压缩后仍过大，请换一张图片');
  }
  let scale = Math.min(1, 1920 / Math.max(width, height));
  for (let attempt = 0; attempt < 4; attempt++, scale *= 0.75) {
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.7, 0.6, 0.5, 0.4]) {
      const result = encode(canvas, 'image/jpeg', quality, MAX_BACKGROUND_IMAGE_CHARS);
      if (result) return result;
    }
  }
  throw new Error('背景压缩后仍过大，请换一张图片');
}

/** Existing static data-URL API. Its limits and crop/compression behavior are unchanged. */
export async function readLocalImage(file, { kind = 'avatar' } = {}) {
  const checked = validateImageFile(file);
  if (!checked.ok) throw new Error(checked.error);
  if (!['avatar', 'background'].includes(kind)) throw new Error('未知图片用途');
  await checkSignature(file);
  if (typeof globalThis.Image !== 'function' || !globalThis.document?.createElement ||
      typeof globalThis.URL?.createObjectURL !== 'function' || typeof globalThis.URL?.revokeObjectURL !== 'function') {
    throw new Error('此环境不支持本地图片处理');
  }
  let objectUrl;
  try {
    objectUrl = URL.createObjectURL(file);
    const image = await decodeImage(objectUrl);
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        width > 32_768 || height > 32_768 || width * height > MAX_IMAGE_PIXELS) {
      throw new Error('图片尺寸无效或超过 5000 万像素，请先缩小图片');
    }
    return posterFor(image, width, height, kind);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('图片处理失败，请换一张图片');
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

const ascii = (b, start, size) => String.fromCharCode(...b.subarray(start, start + size));
function malformed() { throw new Error('媒体结构无效、截断或包含不支持的动画'); }
function need(b, start, size) { if (start < 0 || size < 0 || start + size > b.length) malformed(); }
function uint(b, start, size, little = true) {
  need(b, start, size);
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + b[start + (little ? size - 1 - i : i)];
  return value;
}
function dimensions(width, height, limit) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > limit.edge || height > limit.edge) throw new Error(`媒体尺寸必须在 ${limit.edge} 像素以内`);
}
function frameBudget(width, height, count, limit) {
  if (count > limit.frames || width * height * count > MAX_ANIMATION_PIXELS) throw new Error('动画帧数或累计画布像素超限');
}
function gifInfo(b, limit) {
  need(b, 0, 13);
  if (!['GIF87a', 'GIF89a'].includes(ascii(b, 0, 6))) malformed();
  const width = uint(b, 6, 2), height = uint(b, 8, 2);
  dimensions(width, height, limit);
  let p = 13, frames = 0, imageBytes = 0;
  if (b[10] & 128) { const size = 3 * (2 ** ((b[10] & 7) + 1)); need(b, p, size); p += size; }
  function blocks() {
    let total = 0;
    for (;;) {
      need(b, p, 1); const size = b[p++];
      if (!size) return total;
      need(b, p, size); total += size; p += size;
    }
  }
  while (p < b.length) {
    const tag = b[p++];
    if (tag === 0x3b) { if (!frames || !imageBytes || p !== b.length) malformed(); return { width, height, animated: frames > 1 }; }
    if (tag === 0x21) { need(b, p, 1); p++; blocks(); continue; }
    if (tag !== 0x2c) malformed();
    need(b, p, 9);
    const left = uint(b, p, 2), top = uint(b, p + 2, 2), w = uint(b, p + 4, 2), h = uint(b, p + 6, 2), flags = b[p + 8];
    if (!w || !h || left + w > width || top + h > height || (flags & 24)) malformed();
    p += 9;
    frameBudget(width, height, ++frames, limit);
    if (flags & 128) { const size = 3 * (2 ** ((flags & 7) + 1)); need(b, p, size); p += size; }
    need(b, p, 1); const code = b[p++]; if (code < 2 || code > 8) malformed();
    const size = blocks(); if (!size) malformed(); imageBytes += size;
  }
  malformed();
}

function webpPayload(b, start, end) {
  let p = start, payload = 0, alpha = false, result;
  while (p < end) {
    need(b, p, 8); const tag = ascii(b, p, 4), n = uint(b, p + 4, 4); p += 8;
    if (!n || p + n + (n & 1) > end) malformed();
    if (tag === 'ALPH') { if (alpha || payload) malformed(); alpha = true; }
    else if (tag === 'VP8 ') {
      if (++payload > 1 || n < 10 || (b[p] & 1) || ascii(b, p + 3, 3) !== '\x9d\x01\x2a') malformed();
      result = { width: uint(b, p + 6, 2) & 0x3fff, height: uint(b, p + 8, 2) & 0x3fff };
    } else if (tag === 'VP8L') {
      if (++payload > 1 || alpha || n < 5 || b[p] !== 0x2f || (b[p + 4] & 0xe0)) malformed();
      const bits = uint(b, p + 1, 4);
      result = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    } else malformed();
    p += n + (n & 1);
  }
  if (p !== end || payload !== 1) malformed();
  return result;
}
function webpInfo(b, limit) {
  need(b, 0, 12);
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP' || uint(b, 4, 4) + 8 !== b.length) malformed();
  let p = 12, width, height, extended = false, animation = false, animHeader = false, frames = 0, still = false, alpha = false;
  while (p < b.length) {
    need(b, p, 8); const tag = ascii(b, p, 4), n = uint(b, p + 4, 4); p += 8;
    need(b, p, n + (n & 1));
    if (tag === 'VP8X') {
      if (extended || p !== 20 || n !== 10 || (b[p] & 0xc1) || b[p + 1] || b[p + 2] || b[p + 3]) malformed();
      extended = true; animation = Boolean(b[p] & 2);
      width = uint(b, p + 4, 3) + 1; height = uint(b, p + 7, 3) + 1; dimensions(width, height, limit);
    } else if (tag === 'ANIM') {
      if (!animation || animHeader || frames || n !== 6) malformed(); animHeader = true;
    } else if (tag === 'ANMF') {
      if (!animation || !animHeader || n < 24) malformed();
      const x = uint(b, p, 3) * 2, y = uint(b, p + 3, 3) * 2;
      const w = uint(b, p + 6, 3) + 1, h = uint(b, p + 9, 3) + 1;
      if (x + w > width || y + h > height || (b[p + 15] & 0xfc)) malformed();
      frameBudget(width, height, ++frames, limit);
      const payload = webpPayload(b, p + 16, p + n);
      if (payload.width !== w || payload.height !== h) malformed();
    } else if (tag === 'VP8 ' || tag === 'VP8L') {
      if (animation || still || !n || (alpha && tag === 'VP8L')) malformed();
      const info = webpPayload(b, p - 8, p + n + (n & 1));
      if (extended && (info.width !== width || info.height !== height)) malformed();
      width = info.width; height = info.height; dimensions(width, height, limit); still = true;
    } else if (tag === 'ALPH') {
      if (!extended || animation || still || alpha || !n) malformed(); alpha = true;
    } else if (!extended || !['ICCP', 'EXIF', 'XMP '].includes(tag)) malformed();
    p += n + (n & 1);
  }
  if (animation ? !frames || !animHeader || still : !still) malformed();
  return { width, height, animated: animation };
}
function pngInfo(b, limit) {
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)) malformed();
  let p = 8, width, height, ended = false, data = false;
  while (p < b.length) {
    need(b, p, 12); const n = uint(b, p, 4, false), tag = ascii(b, p + 4, 4); need(b, p + 8, n + 4);
    if (['acTL', 'fcTL', 'fdAT'].includes(tag)) throw new Error('暂不支持 APNG 动画，请使用 GIF 或 WebP');
    if (tag === 'IHDR') {
      if (p !== 8 || width !== undefined || n !== 13) malformed();
      width = uint(b, p + 8, 4, false); height = uint(b, p + 12, 4, false); dimensions(width, height, limit);
    } else if (width === undefined) malformed();
    if (tag === 'IDAT') data = true;
    p += n + 12;
    if (tag === 'IEND') { if (n || p !== b.length) malformed(); ended = true; break; }
  }
  if (!ended || !data) malformed();
  return { width, height, animated: false };
}
function posterBlob(poster) {
  const [header, body] = poster.split(',');
  const mime = header.slice(5, header.indexOf(';'));
  const binary = globalThis.atob(body);
  return new Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type: mime });
}
async function readBytes(file) {
  const source = typeof file.arrayBuffer === 'function' ? file : file.slice?.(0, file.size);
  if (typeof source?.arrayBuffer !== 'function') throw new Error('无法读取本地媒体');
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (bytes.length !== file.size) malformed();
  return bytes;
}
function videoPoster(file, kind) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let settled = false, metadata = false;
    const timer = setTimeout(() => finish(new Error('视频解码超时')), 15_000);
    function finish(error, value) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      video.onloadedmetadata = video.onloadeddata = video.onerror = null;
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* Detached browser decoder. */ }
      URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(value);
    }
    function frame() {
      if (!metadata || video.readyState < 2 || settled) return;
      try {
        finish(null, { poster: posterFor(video, video.videoWidth, video.videoHeight, kind), width: video.videoWidth, height: video.videoHeight, duration: video.duration });
      } catch (error) { finish(error); }
    }
    video.preload = 'auto'; video.muted = true; video.playsInline = true;
    video.onerror = () => finish(new Error('视频无法解码'));
    video.onloadedmetadata = () => {
      try {
        dimensions(video.videoWidth, video.videoHeight, { edge: 3840 });
        if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 120) throw new Error('视频时长必须在 120 秒以内');
        metadata = true; frame();
      } catch (error) { finish(error); }
    };
    video.onloadeddata = frame;
    try { video.src = url; video.load(); } catch (error) { finish(error); }
  });
}

/** Validate bounded local structures before decoding. Dynamic sources retain their original Blob. */
export async function prepareLocalAsset(file, { kind = 'avatar' } = {}) {
  if (!['avatar', 'background', 'font'].includes(kind)) throw new Error('未知媒体用途');
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('请选择有效的本地文件');
  // Windows file pickers can omit a WOFF2 MIME type; the binary header below remains mandatory.
  const mime = kind === 'font' && ['', 'application/octet-stream', 'application/x-woff2'].includes(file.type) && /\.woff2$/i.test(file.name || '') ? 'font/woff2' : file.type;
  const font = kind === 'font', video = ['video/mp4', 'video/webm'].includes(mime);
  if (font ? !['font/woff2', 'application/font-woff2', 'application/x-font-woff2'].includes(mime) :
    !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'].includes(mime)) throw new Error('不支持的本地媒体格式');
  if (video && kind !== 'background') throw new Error('视频只能用作背景');
  const max = font ? 5 * MiB : video ? 30 * MiB : mime === 'image/gif' ? limits[kind].bytes : MAX_IMAGE_FILE_BYTES;
  if (file.size > max) throw new Error(`本地文件不能超过 ${max / MiB} MiB`);
  const bytes = await readBytes(file);
  if (font) {
    if (bytes.length < 48 || ascii(bytes, 0, 4) !== 'wOF2' || uint(bytes, 8, 4, false) !== bytes.length) malformed();
    if (typeof globalThis.FontFace !== 'function') throw new Error('浏览器不支持本地字体');
    await new FontFace('LimeUserFont', bytes.buffer).load();
    const blob = file.type === 'font/woff2' ? file : new Blob([bytes], { type: 'font/woff2' });
    return { blob, poster: '', mime: 'font/woff2', type: 'font', animated: false, width: 0, height: 0 };
  }
  if (video) {
    if (mime === 'video/mp4') {
      if (bytes.length < 16 || ascii(bytes, 4, 4) !== 'ftyp' || uint(bytes, 0, 4, false) < 16 || uint(bytes, 0, 4, false) > bytes.length) malformed();
    } else if (![0x1a, 0x45, 0xdf, 0xa3].every((v, i) => bytes[i] === v)) malformed();
    const info = await videoPoster(file, kind);
    return { blob: file, ...info, mime, type: 'video', animated: true };
  }
  const limit = { ...limits[kind], edge: 32_768 };
  let info;
  if (mime === 'image/gif') info = gifInfo(bytes, limit);
  else if (mime === 'image/webp') info = webpInfo(bytes, limit);
  else if (mime === 'image/png') info = pngInfo(bytes, limit);
  else if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) malformed();
  if (info?.animated) {
    dimensions(info.width, info.height, limits[kind]);
    if (file.size > limits[kind].bytes) throw new Error(`动态图不能超过 ${limits[kind].bytes / MiB} MiB`);
  }
  // Reject oversized headers before decoding: a 10 MB PNG can declare billions of pixels.
  if (info && info.width * info.height > MAX_IMAGE_PIXELS) {
    throw new Error('图片超过5000万像素，请先缩小');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await decodeImage(url), width = image.naturalWidth, height = image.naturalHeight;
    dimensions(width, height, info?.animated ? limits[kind] : limit);
    if (width * height > MAX_IMAGE_PIXELS) throw new Error('图片超过5000万像素，请先缩小');
    if (info && (width !== info.width || height !== info.height)) malformed();
    const poster = info?.animated || mime === 'image/gif' ? posterFor(image, width, height, kind) : await readLocalImage(file, { kind });
    const animated = info?.animated ?? false;
    const blob = animated ? file : posterBlob(poster);
    return { blob, poster, mime: animated ? mime : blob.type, type: 'image', animated, width, height };
  } finally { URL.revokeObjectURL(url); }
}
