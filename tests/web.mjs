import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytes } from "../docs/core.js";
import { presets, parseProgram, decode, hex } from "../docs/isa.js";
const exports = (await WebAssembly.instantiate(bytes, {})).instance.exports;
const cpu = Object.fromEntries(
  Object.entries(exports)
    .filter(([, v]) => typeof v === "function")
    .map(([k, f]) => [k, (...args) => f(...args) >>> 0]),
);
assert.equal(
  WebAssembly.Module.imports(new WebAssembly.Module(bytes)).length,
  0,
);
assert.equal(exports.memory.buffer.byteLength, 196608);
assert.throws(() => exports.memory.grow(1));
let checks = 3;
function ok(v, msg) {
  assert.ok(v, msg);
  checks++;
}
function eq(a, b, msg) {
  assert.deepEqual(a, b, msg);
  checks++;
}
function load(words) {
  cpu.reset();
  for (let i = 0; i < words.length; i++)
    for (let j = 0; j < 4; j++)
      ok(cpu.poke(i * 4 + j, (words[i] >>> (8 * j)) & 255));
}
eq(cpu.poke(65536, 0), 0);
eq(cpu.poke(0xffffffff, 0), 0);
eq(cpu.poke(0, 256), 0);
eq(cpu.byte_at(65536), 0);
const dir = mkdtempSync(join(tmpdir(), "bitforge-"));
try {
  for (const p of presets) {
    load(p.words);
    let n = 0;
    while (!cpu.status() && n++ < 1000) cpu.step();
    eq(cpu.status(), 9, p.id);
    const output = join(dir, p.id + ".hex");
    writeFileSync(output, p.words.map((w) => hex(w)).join("\n") + "\n");
    const run = spawnSync("./build/bitforge", [output], { encoding: "utf8" });
    eq(run.status, 0, run.stderr);
    const native = JSON.parse(run.stdout);
    eq(
      Array.from({ length: 32 }, (_, i) => cpu.reg(i)),
      native.registers,
      p.id + " registers",
    );
    eq(
      [cpu.pc(), cpu.status(), cpu.tval(), cpu.retired()],
      [native.pc, native.status, native.tval, native.retired],
      p.id + " state",
    );
    eq(
      Array.from({ length: 64 }, (_, i) => cpu.byte_at(0x400 + i)),
      native.memory_0x400,
      p.id + " memory",
    );
    if (p.id === "sum") {
      eq(cpu.reg(2), 55);
      eq(cpu.retired(), 34);
    }
    if (p.id === "fibonacci") {
      eq(cpu.reg(2), 144);
      eq(cpu.reg(3), 233);
      eq(
        Array.from({ length: 12 }, (_, i) => cpu.byte_at(0x400 + i * 4)),
        [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89],
      );
    }
    if (p.id === "bytes") {
      eq(cpu.reg(3), 0xffffff80);
      eq(cpu.reg(4), 128);
      eq(cpu.reg(5), 0xffffffff);
    }
    if (p.id === "call") {
      eq(cpu.reg(1), 8);
      eq(cpu.reg(10), 42);
    }
  }
  for (const text of [
    "",
    "1234567",
    "0000000g",
    "00000013 00100073",
    "00000013\nxx",
    "0x00000013",
    "a".repeat(180001),
    Array(16385).fill("00000013").join("\n"),
  ]) {
    assert.throws(() => parseProgram(text));
    checks++;
  }
  eq(parseProgram("# comment\n00000013 # nop\n00100073\n"), [0x13, 0x100073]);
  eq(parseProgram(Array(16384).fill("00000013").join("\n")).length, 16384);
  // Every disassembly legality decision must agree with the C decoder. Sticky traps reset per case.
  let seed = 0x1357c0de;
  for (let n = 0; n < 100000; n++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const w = seed >>> 0;
    cpu.reset();
    for (let j = 0; j < 4; j++) cpu.poke(j, (w >>> (8 * j)) & 255);
    cpu.step();
    eq(decode(w).name === "illegal", cpu.status() === 3, "decode " + hex(w));
  }
  // Native parser failures and bounded loop result must be explicit, never partial success.
  for (const text of [
    "",
    "123",
    "00000013 00100073",
    "00000013\nnotaword",
    "f".repeat(256),
    "00000013\u0000garbage",
  ]) {
    const file = join(dir, "bad.hex");
    writeFileSync(file, text);
    eq(spawnSync("./build/bitforge", [file]).status, 1);
  }
  const loop = join(dir, "loop.hex");
  writeFileSync(loop, "0000006f\n");
  const out = spawnSync("./build/bitforge", [loop, "37"], { encoding: "utf8" });
  eq(out.status, 3);
  eq(JSON.parse(out.stdout).retired, 37);
  for (const arg of ["0", "1000001", "abc", "1x", "-1"])
    eq(spawnSync("./build/bitforge", [loop, arg]).status, 1);
  console.log(
    `${checks} WASM / native program, parser, and decode assertions passed`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
