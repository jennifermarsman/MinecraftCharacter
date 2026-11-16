import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { defaults } from "../../server/catalog.js";

test("upload, demo build, customization, and PNG download", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Your next adventure/ })).toBeVisible();
  const build = page.getByRole("button", { name: "Build demo character" });
  await expect(build).toBeDisabled();
  await expect(page.getByRole("link", { name: "Download skin" })).toHaveAttribute("aria-disabled", "false");
  const image = await sharp({ create: { width: 100, height: 160, channels: 3, background: "#bd9e7a" } }).png().toBuffer();
  await page.getByLabel("Upload a person photograph").setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: image });
  await expect(page.getByAltText("Your uploaded inspiration photograph")).toBeVisible();
  await build.click();
  await expect(page.getByRole("status")).toContainText("your photo has not been analyzed");
  await page.getByLabel("Hair color", { exact: true }).selectOption("pink");
  await page.getByLabel("Bottom style", { exact: true }).selectOption("long-skirt");
  const previousSkin = await page.getByRole("link", { name: "Download skin" }).getAttribute("href");
  await page.getByLabel("Top style", { exact: true }).selectOption({ label: "Suit coat / blazer" });
  await expect(page.getByLabel("Top style", { exact: true })).toHaveValue("blazer");
  await expect(page.getByRole("link", { name: "Download skin" })).not.toHaveAttribute("href", previousSkin!);
  await expect(page.getByRole("link", { name: "Download skin" })).toHaveAttribute("aria-disabled", "false");
  await expect(page.getByLabel("Bottom style", { exact: true }).getByRole("option", { name: "Tutu", exact: true })).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download skin" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("block-and-you-skin.png");
  const file = await download.path();
  expect((await sharp(file!).metadata()).width).toBe(64);
  await page.getByRole("button", { name: "Pause rotation" }).click();
  await expect(page.getByRole("button", { name: "Start rotation" })).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("mobile layout fits and unsupported uploads give feedback", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByLabel("Hair color", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel("Upload a person photograph").setInputFiles({ name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("invalid") });
  await expect(page.getByRole("alert")).toContainText("PNG, JPEG, or WebP");
});

test("live mode displays selected features and keeps the editor usable after an inference error", async ({ page }) => {
  await page.route("**/api/catalog", async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ json: { ...data, mode: "live" } });
  });
  let fail = false;
  await page.route("**/api/generate", async route => {
    if (fail) {
      await route.fulfill({ status: 503, json: { error: "Foundry denied access. Check the server credential." } });
      return;
    }
    await route.fulfill({ json: {
      appearance: { ...defaults, hairColor: "pink", bottomStyle: "long-skirt" },
      decisions: [], mode: "live",
      message: "Decision 1.1 selected your character's appearance from the photo.",
    } });
  });
  await page.goto("/");
  await expect(page.getByText("Microsoft Decision 1.1", { exact: true })).toBeVisible();
  await expect(page.getByText(/Photo analysis sends the normalized image/)).toBeVisible();
  const image = await sharp({ create: { width: 10, height: 20, channels: 3, background: "#ad8261" } }).png().toBuffer();
  await page.getByLabel("Upload a person photograph").setInputFiles({ name: "person.png", mimeType: "image/png", buffer: image });
  await page.getByRole("button", { name: "Build my character" }).click();
  await expect(page.getByRole("status")).toContainText("selected your character");
  await expect(page.getByLabel("Hair color", { exact: true })).toHaveValue("pink");
  await expect(page.getByLabel("Bottom style", { exact: true })).toHaveValue("long-skirt");
  await expect(page.getByRole("link", { name: "Download skin" })).toHaveAttribute("aria-disabled", "false");
  fail = true;
  await page.getByRole("button", { name: "Build my character" }).click();
  await expect(page.getByRole("alert")).toContainText("Foundry denied access");
  await expect(page.getByLabel("Hair color", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Hair color", { exact: true })).toHaveValue("pink");
  await page.getByRole("button", { name: "Reset to default palette" }).click();
  await expect(page.getByRole("status")).toContainText("previous model selections have been cleared");
});
