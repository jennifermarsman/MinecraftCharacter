import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { catalog, defaults, validateAppearance } from "../server/catalog.js";
import { renderSkin } from "../server/skin.js";
import { buildDecisionInput, createProvider } from "../server/decision.js";

test("skin has modern classic UV dimensions, opaque base faces, and transparent unused space", async () => {
  const png = await renderSkin(defaults);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 64);
  assert.equal(info.height, 64);
  assert.equal(info.channels, 4);
  const alpha = (x: number, y: number) => data[(y * 64 + x) * 4 + 3];
  const boxes = [
    [0, 0, 8, 8, 8], [16, 16, 8, 12, 4], [40, 16, 4, 12, 4],
    [0, 16, 4, 12, 4], [16, 48, 4, 12, 4], [32, 48, 4, 12, 4],
  ];
  for (const [x, y, w, h, d] of boxes) {
    for (let px = x; px < x + 2 * (w + d); px++) {
      for (let py = y + d; py < y + d + h; py++) assert.equal(alpha(px, py), 255);
    }
    for (let px = x + d; px < x + d + 2 * w; px++) {
      for (let py = y; py < y + d; py++) assert.equal(alpha(px, py), 255);
    }
  }
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(63, 63), 0);
});

test("every supported option renders; meaningful changes produce different textures", async () => {
  const base = await renderSkin(defaults);
  for (const category of catalog) {
    for (const option of category.options) {
      const appearance = { ...defaults, [category.id]: option.id };
      if (category.id === "hairStyle") appearance.hairLength = "long";
      const png = await renderSkin(appearance);
      assert.equal((await sharp(png).metadata()).width, 64);
      if (option.id !== category.default && option.id !== "unknown") {
        assert.notDeepEqual(png, base, `${category.id}/${option.id} should affect the texture`);
      }
    }
  }
});

test("all hair styles yield distinct long-hair textures", async () => {
  const textures = await Promise.all(catalog.find(c => c.id === "hairStyle")!.options.map(o =>
    renderSkin({ ...defaults, hairLength: "long", hairStyle: o.id }).then(b => b.toString("base64")),
  ));
  assert.equal(new Set(textures).size, textures.length);
});

test("appearance validation rejects missing, additional, and unknown choices", () => {
  assert.deepEqual(validateAppearance(defaults), defaults);
  assert.throws(() => validateAppearance({ ...defaults, hairStyle: "injected" }));
  assert.throws(() => validateAppearance({ hairColor: "black" }));
  assert.throws(() => validateAppearance({ ...defaults, extra: "unexpected" }));
});

test("decision questions use the exact backend catalog and normalized image", () => {
  const image = Buffer.from("normalized-image");
  const input = buildDecisionInput(image);
  assert.equal(input.image.base64, image.toString("base64"));
  for (const category of catalog) {
    assert.deepEqual(Object.keys(input.questions[category.id].criteria), category.options.map(o => o.id));
  }
});

test("demo is explicitly not photo analysis; placeholder never fabricates model answers", async () => {
  const input = buildDecisionInput(Buffer.from("image"));
  const result = await createProvider("demo").decide(input);
  assert.equal(result.mode, "demo");
  assert.match(result.message, /not been analyzed/);
  assert.ok(result.decisions.every(d => d.confidence === null));
  await assert.rejects(createProvider("placeholder").decide(input), /not configured/);
  assert.throws(() => createProvider("unexpected"), /DECISION_MODE/);
});
