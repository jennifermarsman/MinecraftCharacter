import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../server/app.js";
import { defaults } from "../server/catalog.js";
import { DemoDecisionProvider, PendingFoundryProvider, type DecisionInput } from "../server/decision.js";

const image = () => sharp({ create: { width: 40, height: 50, channels: 3, background: "#cdb89a" } }).png().toBuffer();
const app = () => createApp(new DemoDecisionProvider());

test("catalog, image upload, generated skin, and downloadable edited skin work end to end", async () => {
  const server = app();
  const catalog = await request(server).get("/api/catalog").expect(200);
  assert.equal(catalog.body.categories.length, 12);
  const response = await request(server).post("/api/generate").attach("image", await image(), "portrait.png").expect(200);
  assert.equal(response.body.mode, "demo");
  assert.match(response.body.message, /not been analyzed/);
  const png = Buffer.from(response.body.skin.split(",")[1], "base64");
  assert.equal((await sharp(png).metadata()).width, 64);
  const edited = await request(server).post("/api/skin").send({
    appearance: { ...response.body.appearance, hairColor: "pink", bottomStyle: "long-skirt" },
  }).expect("Content-Type", /image\/png/).expect(200);
  assert.match(edited.headers["content-disposition"], /attachment/);
  assert.notDeepEqual(edited.body, png);
  assert.equal((await sharp(edited.body).metadata()).height, 64);
  assert.equal(response.headers["cache-control"], "no-store");
});

test("rejects absent, corrupt, disguised, animated, oversized, and additional uploads", async () => {
  const server = app();
  await request(server).post("/api/generate").expect(400);
  await request(server).post("/api/generate").attach("image", Buffer.from("not an image"), "fake.png").expect(400);
  await request(server).post("/api/generate").attach("image", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>"), "fake.png").expect(400);
  const gif = await sharp(await image()).gif().toBuffer();
  await request(server).post("/api/generate").attach("image", gif, "portrait.gif").expect(400);
  await request(server).post("/api/generate").attach("image", Buffer.alloc(10 * 1024 * 1024 + 1), "large.png").expect(400);
  await request(server).post("/api/generate").attach("image", await image(), "one.png").attach("other", await image(), "two.png").expect(400);
});

test("normalizes valid images before passing them to provider", async () => {
  let captured: DecisionInput | undefined;
  const demo = new DemoDecisionProvider();
  const server = createApp({ mode: "demo", async decide(input) { captured = input; return demo.decide(input); } });
  const jpeg = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#899467" } }).jpeg().toBuffer();
  await request(server).post("/api/generate").attach("image", jpeg, "image.jpg").expect(200);
  assert.ok(captured);
  const meta = await sharp(Buffer.from(captured.image.base64, "base64")).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 1536);
  assert.equal(meta.height, 768);
  assert.equal(meta.exif, undefined);
});

test("placeholder and invalid provider outputs fail explicitly without fake success", async () => {
  await request(createApp(new PendingFoundryProvider())).post("/api/generate").attach("image", await image(), "photo.png").expect(503);
  const demo = new DemoDecisionProvider();
  const server = createApp({ mode: "demo", async decide(input) {
    const result = await demo.decide(input);
    return { ...result, appearance: { ...defaults, eyeColor: "impossible" } };
  } });
  await request(server).post("/api/generate").attach("image", await image(), "photo.png").expect(502);
});

test("invalid edit requests, invalid JSON, and unknown routes report errors", async () => {
  const server = app();
  await request(server).post("/api/skin").send({ appearance: { ...defaults, sleeves: "invalid" } }).expect(400);
  await request(server).post("/api/skin").send({}).expect(400);
  await request(server).post("/api/skin").type("json").send("{").expect(400);
  await request(server).get("/api/missing").expect(404);
});
