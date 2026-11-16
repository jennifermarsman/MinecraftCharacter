import sharp from "sharp";
import { colorFor, validateAppearance } from "./catalog.js";
import type { Appearance } from "../shared/types.js";

type Face = "top" | "bottom" | "right" | "front" | "left" | "back";
interface Rect { x: number; y: number; w: number; h: number }
type Box = Record<Face, Rect>;

function box(x: number, y: number, w: number, h: number, d: number): Box {
  return {
    top: { x: x + d, y, w, h: d },
    bottom: { x: x + d + w, y, w, h: d },
    right: { x, y: y + d, w: d, h },
    front: { x: x + d, y: y + d, w, h },
    left: { x: x + d + w, y: y + d, w: d, h },
    back: { x: x + 2 * d + w, y: y + d, w, h },
  };
}

export async function renderSkin(input: Appearance): Promise<Buffer> {
  const a = validateAppearance(input);
  const pixels = Buffer.alloc(64 * 64 * 4);
  const skin = colorFor(a, "skinTone"), hair = colorFor(a, "hairColor");
  const top = colorFor(a, "topColor"), bottom = colorFor(a, "bottomColor");
  const shoes = colorFor(a, "shoeColor"), eyes = colorFor(a, "eyeColor");
  function paint(r: Rect, color: string, shade = 0, texture = true) {
    const rgb = [1, 3, 5].map(i => Number.parseInt(color.slice(i, i + 2), 16));
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const noise = texture ? ((x * 17 + y * 31) % 7) - 3 : 0;
        const i = (y * 64 + x) * 4;
        rgb.forEach((v, j) => { pixels[i + j] = Math.max(0, Math.min(255, v + shade + noise)); });
        pixels[i + 3] = 255;
      }
    }
  }
  function row(r: Rect, start: number, height: number, color: string, shade = 0) {
    const end = Math.min(r.h, start + height);
    if (end > start) paint({ ...r, y: r.y + start, h: end - start }, color, shade);
  }
  function fill(b: Box, color: string) {
    for (const [face, r] of Object.entries(b)) {
      paint(r, color, face === "top" ? 9 : face === "bottom" ? -15 : face === "front" ? 0 : -7);
    }
  }
  const head = box(0, 0, 8, 8, 8);
  const body = box(16, 16, 8, 12, 4);
  const arms = [box(40, 16, 4, 12, 4), box(32, 48, 4, 12, 4)];
  const legs = [box(0, 16, 4, 12, 4), box(16, 48, 4, 12, 4)];
  fill(head, skin);
  fill(body, top);
  arms.forEach(arm => {
    fill(arm, skin);
    const length = a.sleeves === "long" ? 10 : a.sleeves === "short" ? 4 : 0;
    if (length) for (const [face, r] of Object.entries(arm)) {
      if (face === "top") paint(r, top, 8);
      else if (face !== "bottom") row(r, 0, length, top, -3);
    }
  });
  legs.forEach(leg => {
    fill(leg, skin);
    const length = ["shorts", "short-skirt"].includes(a.bottomStyle) ? 5 : 12;
    for (const [face, r] of Object.entries(leg)) {
      if (face === "top") paint(r, bottom);
      else if (face === "bottom") paint(r, shoes, -15);
      else {
        row(r, 0, length, bottom, face === "front" ? 0 : -8);
        row(r, 10, 2, shoes);
        row(r, 11, 1, shoes, -18);
        if (["short-skirt", "long-skirt"].includes(a.bottomStyle)) {
          paint({ x: r.x + 1, y: r.y, w: 1, h: Math.min(length, 10) }, bottom, -15);
        }
      }
    }
  });
  // Skirts remain texture-based on the standard model; no unsupported custom geometry.
  if (["short-skirt", "long-skirt"].includes(a.bottomStyle)) {
    const waist = box(16, 32, 8, 12, 4);
    for (const face of ["front", "back", "left", "right"] as const) {
      row(waist[face], 10, 2, bottom);
    }
  }
  paint({ x: 23, y: 20, w: 2, h: 1 }, skin);
  if (a.topStyle === "striped") {
    for (const face of ["front", "back", "left", "right"] as const) {
      for (const y of [3, 6, 9]) row(body[face], y, 1, top, 30);
    }
  } else if (a.topStyle === "shirt") {
    paint({ x: 23, y: 21, w: 1, h: 11 }, top, -22);
    for (const y of [23, 26, 29]) paint({ x: 24, y, w: 1, h: 1 }, "#e5ded2");
    paint({ x: 21, y: 20, w: 2, h: 2 }, top, 20);
    paint({ x: 25, y: 20, w: 2, h: 2 }, top, 20);
  } else if (a.topStyle === "blazer") {
    paint({ x: 23, y: 21, w: 2, h: 5 }, "#e5ded2");
    for (let y = 0; y < 4; y++) {
      paint({ x: 22 + Math.floor(y / 2), y: 21 + y, w: 1, h: 1 }, top, 24);
      paint({ x: 25 - Math.floor(y / 2), y: 21 + y, w: 1, h: 1 }, top, 24);
    }
    paint({ x: 23, y: 26, w: 1, h: 6 }, top, -22);
    for (const y of [26, 29]) paint({ x: 24, y, w: 1, h: 1 }, "#e5ded2");
    for (const x of [20, 26]) paint({ x, y: 28, w: 2, h: 1 }, top, -22);
  } else if (a.topStyle === "hoodie") {
    paint({ x: 22, y: 22, w: 1, h: 3 }, "#e5ded2");
    paint({ x: 25, y: 22, w: 1, h: 3 }, "#e5ded2");
    paint({ x: 22, y: 28, w: 4, h: 2 }, top, -15);
    row(body.back, 0, 3, top, -20);
  }
  paint({ x: 9, y: 11, w: 2, h: 1 }, "#f4ede3", 0, false);
  paint({ x: 13, y: 11, w: 2, h: 1 }, "#f4ede3", 0, false);
  paint({ x: 10, y: 11, w: 1, h: 1 }, eyes, 0, false);
  paint({ x: 13, y: 11, w: 1, h: 1 }, eyes, 0, false);
  paint({ x: 11, y: 12, w: 2, h: 1 }, skin, -18);
  paint({ x: 11, y: 14, w: 2, h: 1 }, skin, -35);
  if (a.hairLength !== "bald") {
    paint(head.top, hair, 8);
    row(head.front, 0, a.hairStyle === "bangs" ? 3 : 2, hair);
    for (const face of ["back", "left", "right"] as const) {
      row(head[face], 0, a.hairLength === "short" ? 5 : 8, hair, -6);
    }
    if (a.hairStyle === "side-part") paint({ x: 8, y: 10, w: 2, h: 1 }, hair);
    const outer = box(32, 0, 8, 8, 8);
    paint(outer.top, hair, 10);
    row(outer.front, 0, a.hairStyle === "bangs" ? 3 : 1, hair);
    const textured = ["curly", "wavy", "braids"].includes(a.hairStyle);
    for (const face of ["left", "right", "back"] as const) {
      row(outer[face], 0, a.hairLength === "short" ? 4 : 8, hair, -2);
      if (textured) {
        const r = outer[face];
        const height = a.hairLength === "short" ? 4 : 8;
        const spacing = a.hairStyle === "wavy" ? 3 : 2;
        for (let x = 0; x < r.w; x += spacing) {
          for (let y = 1; y < height; y += 3) {
            paint({ x: r.x + x, y: r.y + y, w: 1, h: Math.min(2, height - y) }, hair, -23);
          }
        }
      }
    }
    if (a.hairStyle === "bun") {
      paint({ x: 58, y: 10, w: 4, h: 4 }, hair, 18);
    }
    if (a.hairLength !== "short") {
      const back = box(16, 32, 8, 12, 4).back;
      const tied = ["ponytail", "braids", "bun"].includes(a.hairStyle);
      const width = a.hairStyle === "bun" ? 2 : tied ? 4 : 8;
      const height = a.hairStyle === "bun" ? 2 : a.hairLength === "long" ? 10 : 4;
      paint({ x: back.x + (8 - width) / 2, y: back.y, w: width, h: height }, hair, -6);
      if (!tied) {
        for (const x of [20, 26]) paint({ x, y: 36, w: 2, h: height }, hair);
      }
      if (a.hairStyle === "braids") {
        paint({ x: back.x + 3, y: back.y, w: 2, h: height }, hair, -25);
      }
    }
  }
  if (a.glasses !== "none") {
    for (const x of [40, 44]) {
      paint({ x, y: 10, w: 3, h: 3 }, "#29292d", 0, false);
      if (a.glasses === "regular") {
        paint({ x: x + 1, y: 11, w: 1, h: 1 }, eyes, 0, false);
      }
    }
    paint({ x: 43, y: 11, w: 1, h: 1 }, "#29292d", 0, false);
  }
  return sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer();
}
