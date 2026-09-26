type Box = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };

/**
 * Where the image is actually DRAWN inside its element. With `object-fit:
 * contain` the element may contain a letterbox; the reported box is the
 * centered, aspect-fit image area. Any other fit mode maps 1:1 to the element
 * rect. Kept dependency-free so client components can import it safely.
 */
export function imageDisplayBox(rect: Box, natural: Size | null, objectFit: string): Box {
  if (!natural || natural.width <= 0 || natural.height <= 0 || objectFit !== "contain") return rect;
  const scale = Math.min(rect.width / natural.width, rect.height / natural.height);
  const w = natural.width * scale;
  const h = natural.height * scale;
  return { left: rect.left + (rect.width - w) / 2, top: rect.top + (rect.height - h) / 2, width: w, height: h };
}

/**
 * Maps a pointer coordinate to normalized 0..1 targets INSIDE the rendered
 * image box (letterbox excluded). Clamped so clicks land 0..1 even outside it.
 */
export function normalizedTargetFromPoint(point: { x: number; y: number }, box: Box) {
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
  const x = Math.max(0, Math.min(1, (point.x - box.left) / box.width));
  const y = Math.max(0, Math.min(1, (point.y - box.top) / box.height));
  return { x, y };
}