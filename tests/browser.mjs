import { bytes } from "../docs/core.js";
import { presets, hex } from "../docs/isa.js";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import assert from "node:assert/strict";
const root = resolve("docs");
const shots = resolve(process.env.BITFORGE_SHOTS || "build/screenshots");
const server = createServer(async (req, res) => {
  try {
    const path = resolve(
      root,
      "." +
        decodeURIComponent(
          new URL(req.url, "http://localhost").pathname.replace(
            /\/$/,
            "/index.html",
          ),
        ),
    );
    if (!path.startsWith(root + "/")) throw Error("path");
    const data = await readFile(path);
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      }[extname(path)] || "application/octet-stream",
    );
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base =
  process.env.BITFORGE_URL || `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless: true });
let checks = 0;
const errors = [],
  failures = [],
  requests = [];
function ok(v, msg) {
  assert.ok(v, msg);
  checks++;
}
async function expectText(page, id, text) {
  assert.match(await page.locator("#" + id).innerText(), text);
  checks++;
}
async function loaded(page) {
  await page.goto(base);
  await page.waitForFunction(() =>
    document.querySelector("#runtime").textContent.includes("LOCAL"),
  );
}
async function auditDOM(page, id) {
  const p = presets.find((p) => p.id === id),
    c = (await WebAssembly.instantiate(bytes, {})).instance.exports;
  c.reset();
  for (let i = 0; i < p.words.length; i++)
    for (let j = 0; j < 4; j++)
      c.poke(i * 4 + j, (p.words[i] >>> (j * 8)) & 255);
  for (let i = 0; i < 1000 && !c.status(); i++) c.step();
  const regs = await page.locator(".reg-value").allTextContents();
  for (let i = 0; i < 32; i++)
    ok(regs[i] === hex(c.reg(i)), id + " register " + i);
  const memory = await page
    .locator("#memory tr")
    .evaluateAll((rows) =>
      rows.flatMap((row) =>
        [...row.querySelectorAll("td")].slice(1).map((n) => n.textContent),
      ),
    );
  for (let i = 0; i < 64; i++)
    ok(memory[i] === hex(c.byte_at(0x400 + i), 2), id + " RAM " + i);
  ok((await page.locator("#pc").innerText()) === hex(c.pc()), id + " PC");
  ok(
    (await page.locator("#retired").innerText()).replaceAll(",", "") ===
      String(c.retired() >>> 0),
    id + " retirement",
  );
  const shown = (await page.locator("#bits").innerText()).replaceAll(" ", "");
  const pc = c.pc() >>> 0;
  const word =
    (c.byte_at(pc) |
      (c.byte_at(pc + 1) << 8) |
      (c.byte_at(pc + 2) << 16) |
      (c.byte_at(pc + 3) << 24)) >>>
    0;
  ok(shown === word.toString(2).padStart(32, "0"), id + " encoded bits");
}
await mkdir(shots, { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("request", (r) => requests.push(r.url()));
  page.on("requestfailed", (r) => failures.push(r.url()));
  await loaded(page);
  await expectText(page, "instruction", /^addi$/);
  await page.locator("#step").click();
  await expectText(page, "retired", /^1$/);
  await expectText(page, "receipt", /x1: 00000000 → 0000000a/);
  await page.screenshot({ path: `${shots}/desktop-hero.png`, fullPage: true });
  await page.locator("#run").click();
  await page.waitForFunction(
    () => document.querySelector("#machine-state").textContent === "EBREAK",
  );
  await expectText(page, "retired", /^34$/);
  await expectText(page, "notice", /Intentional breakpoint trap/);
  ok(await page.locator("#run").isDisabled());
  await expectText(page, "memory", /37/);
  await auditDOM(page, "sum");
  await page.locator("#reset").click();
  await page
    .getByRole("button", { name: "Toggle breakpoint at 00000008", exact: true })
    .click();
  await page.locator("#run").click();
  await page.waitForFunction(
    () => document.querySelector("#machine-state").textContent === "Breakpoint",
  );
  await expectText(page, "pc", /^00000008$/);
  await expectText(page, "retired", /^2$/);
  await page.locator("#run").click();
  await page.waitForFunction(
    () => document.querySelector("#retired").textContent === "5",
  );
  await expectText(page, "pc", /^00000008$/);
  await expectText(page, "notice", /Paused before breakpoint/);
  await page.locator("#step").click();
  await expectText(page, "retired", /^6$/);
  await page.locator("#preset").selectOption("sum");
  await page
    .getByRole("button", { name: "Toggle breakpoint at 00000000", exact: true })
    .click();
  await page.locator("#run").click();
  await page.waitForFunction(
    () => document.querySelector("#machine-state").textContent === "Breakpoint",
  );
  await expectText(page, "retired", /^0$/);
  await page.locator("#step").click();
  await expectText(page, "retired", /^1$/);
  for (const id of ["fibonacci", "bytes", "call"]) {
    await page.locator("#preset").selectOption(id);
    await page.locator("#run").click();
    await page.waitForFunction(
      () => document.querySelector("#machine-state").textContent === "EBREAK",
    );
    await auditDOM(page, id);
    ok(
      await page.locator("#listing .current").evaluate((row) => {
        const wrap = row.closest(".listing-wrap"),
          r = row.getBoundingClientRect(),
          w = wrap.getBoundingClientRect();
        return r.top >= w.top + 30 && r.bottom <= w.bottom;
      }),
      id + " current instruction visible",
    );
    if (id === "fibonacci")
      await page.screenshot({ path: `${shots}/fibonacci.png`, fullPage: true });
    if (id === "bytes") {
      await expectText(page, "registers", /ffffff80/);
      await page.locator("#number-format").selectOption("signed");
      await expectText(page, "registers", /-128/);
      await page.locator("#number-format").selectOption("hex");
    }
  }
  await page.locator("#editor summary").click();
  await page.locator("#program-input").fill("invalid");
  const previous = await page.locator("#pc").innerText();
  await page.locator("#load").click();
  await expectText(page, "input-error", /Nothing was loaded/);
  ok(
    (await page.locator("#pc").innerText()) === previous,
    "invalid program is transactional",
  );
  await page.locator("#program-input").fill("00202003");
  await page.locator("#load").click();
  await page.locator("#step").click();
  await expectText(page, "notice", /Load alignment.*00000002/);
  ok(
    (await page.locator("#preset").inputValue()) === "custom",
    "custom program label",
  );
  await expectText(page, "retired", /^0$/);
  await page.locator("#editor summary").click();
  await page.locator("#program-input").fill("0000006f");
  await page.locator("#load").click();
  await page.locator("#run").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#machine-state").textContent === "Budget reached",
    { timeout: 10000 },
  );
  await expectText(page, "retired", /^10,000$/);
  await page.locator("#run").click();
  await page.locator("#run").click();
  await expectText(page, "machine-state", /^Paused$/);
  await page.locator("#memory-address").fill("10000");
  await page.locator("#memory-form button[type=submit]").click();
  await expectText(page, "memory-error", /previous page is unchanged/);
  await page.locator("#memory-address").fill("ffff");
  await page.locator("#memory-form button[type=submit]").click();
  await expectText(page, "memory-caption", /0000ffc0-0000ffff/);
  ok(await page.locator("#memory-next").isDisabled());
  // Instruction-access failure after a legal JALR must not be misrendered as a negative PC.
  await page.locator("#editor summary").click();
  await page.locator("#program-input").fill("800000b7\n00008067");
  await page.locator("#load").click();
  await page.locator("#run").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#notice")
      .textContent.includes("Instruction access"),
  );
  await expectText(page, "pc", /^80000000$/);
  await expectText(page, "retired", /^2$/);
  await expectText(page, "word", /^unavailable$/);
  await expectText(page, "trace", /fetch fault/);
  await page.screenshot({ path: `${shots}/fetch-fault.png`, fullPage: true });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await loaded(page);
    await page.locator("#step").click();
    ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `overflow ${width}`,
    );
    ok(
      await page
        .locator("h1")
        .evaluate(
          (e) =>
            e.offsetHeight / parseFloat(getComputedStyle(e).lineHeight) < 3.1,
        ),
      `headline ${width}`,
    );
    ok(
      await page
        .locator("button:not([disabled]),select:not([disabled])")
        .evaluateAll((ns) =>
          ns
            .filter((n) => n.getBoundingClientRect().width > 0)
            .every((n) => n.getBoundingClientRect().height >= 44),
        ),
      `tap height ${width}`,
    );
    if (width === 768)
      await page.screenshot({
        path: `${shots}/tablet-768.png`,
        fullPage: true,
      });
    if (width === 320 || width === 375)
      await page.screenshot({
        path: `${shots}/mobile-${width}.png`,
        fullPage: true,
      });
  }
  // No outbound network calls, persistence APIs or CSP violations should occur.
  ok(
    await page.evaluate(
      () =>
        localStorage.length === 0 &&
        sessionStorage.length === 0 &&
        document.cookie === "",
    ),
    "no persistence",
  );
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  ok(
    csp.includes("connect-src 'none'") &&
      csp.includes("'wasm-unsafe-eval'") &&
      !csp.includes("'unsafe-eval'") &&
      !csp.includes("'unsafe-inline'"),
    "exact WASM CSP allowance",
  );
  await page.keyboard.press("Tab");
  ok(
    await page.evaluate(() => document.activeElement !== document.body),
    "keyboard focus",
  );
  ok(
    requests.every((url) => new URL(url).origin === new URL(base).origin),
    "origin-only application requests",
  );
  ok(errors.length === 0, JSON.stringify(errors));
  ok(failures.length === 0, JSON.stringify(failures));
  console.log(
    `${checks} browser assertions passed; 5 responsive widths; ${errors.length} console errors; ${failures.length} failed requests`,
  );
  await writeFile(
    `${shots}/browser-result.json`,
    JSON.stringify({ checks, errors, failures, base }, null, 2),
  );
} finally {
  await browser.close();
  server.close();
}
