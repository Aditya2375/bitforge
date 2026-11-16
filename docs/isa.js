export const hex = (v, n = 8) => (v >>> 0).toString(16).padStart(n, "0");
const sx = (v, b) => (v << (32 - b)) >> (32 - b);
const rr = (i) => `x${i}`;
export function decode(w, pc = 0) {
  const op = w & 127,
    rd = (w >>> 7) & 31,
    f = (w >>> 12) & 7,
    a = (w >>> 15) & 31,
    b = (w >>> 20) & 31,
    hi = w >>> 25;
  const imm = w >> 20,
    reg3 = `${rr(rd)}, ${rr(a)}, ${rr(b)}`,
    regi = `${rr(rd)}, ${rr(a)}, ${imm}`;
  let name = "illegal",
    args = "",
    kind = "Reserved encoding";
  if (op === 0x37 || op === 0x17) {
    name = op === 0x37 ? "lui" : "auipc";
    args = `${rr(rd)}, 0x${hex(w >>> 12, 5)}`;
    kind = "U / upper immediate";
  }
  if (op === 0x6f) {
    const j = sx(
      ((w >>> 31) << 20) |
        (((w >>> 12) & 255) << 12) |
        (((w >>> 20) & 1) << 11) |
        (((w >>> 21) & 1023) << 1),
      21,
    );
    name = "jal";
    args = `${rr(rd)}, 0x${hex(pc + j)}`;
    kind = "J / direct jump";
  }
  if (op === 0x67 && f === 0) {
    name = "jalr";
    args = `${rr(rd)}, ${imm}(${rr(a)})`;
    kind = "I / indirect jump";
  }
  if (op === 0x63) {
    name =
      { 0: "beq", 1: "bne", 4: "blt", 5: "bge", 6: "bltu", 7: "bgeu" }[f] ||
      "illegal";
    const off = sx(
      ((w >>> 31) << 12) |
        (((w >>> 7) & 1) << 11) |
        (((w >>> 25) & 63) << 5) |
        (((w >>> 8) & 15) << 1),
      13,
    );
    args = `${rr(a)}, ${rr(b)}, 0x${hex(pc + off)}`;
    kind = "B / conditional branch";
  }
  if (op === 3) {
    name = { 0: "lb", 1: "lh", 2: "lw", 4: "lbu", 5: "lhu" }[f] || "illegal";
    args = `${rr(rd)}, ${imm}(${rr(a)})`;
    kind = "I / memory load";
  }
  if (op === 0x23) {
    name = { 0: "sb", 1: "sh", 2: "sw" }[f] || "illegal";
    args = `${rr(b)}, ${sx(((w >>> 25) << 5) | ((w >>> 7) & 31), 12)}(${rr(a)})`;
    kind = "S / memory store";
  }
  if (op === 0x13) {
    name =
      { 0: "addi", 2: "slti", 3: "sltiu", 4: "xori", 6: "ori", 7: "andi" }[f] ||
      "illegal";
    args = regi;
    if (f === 1 && hi === 0) {
      name = "slli";
      args = `${rr(rd)}, ${rr(a)}, ${b}`;
    }
    if (f === 5 && (hi === 0 || hi === 32)) {
      name = hi === 32 ? "srai" : "srli";
      args = `${rr(rd)}, ${rr(a)}, ${b}`;
    }
    kind = "I / integer immediate";
  }
  if (op === 0x33 && (hi === 0 || (hi === 32 && (f === 0 || f === 5)))) {
    name = {
      0: hi ? "sub" : "add",
      1: "sll",
      2: "slt",
      3: "sltu",
      4: "xor",
      5: hi ? "sra" : "srl",
      6: "or",
      7: "and",
    }[f];
    args = reg3;
    kind = "R / integer register";
  }
  if (op === 0x0f && f === 0) {
    name = "fence";
    args = "";
    kind = "Ordering / single-hart no-op";
  }
  if (w === 0x73 || w === 0x100073) {
    name = w === 0x73 ? "ecall" : "ebreak";
    args = "";
    kind = "Environment / precise trap";
  }
  return {
    name,
    args: name === "illegal" ? "" : args,
    kind: name === "illegal" ? "Reserved or unsupported encoding" : kind,
    op,
    rd,
    f,
    a,
    b,
    hi,
  };
}
const i = (imm, a, f, d, op = 0x13) =>
  (((imm & 4095) << 20) | (a << 15) | (f << 12) | (d << 7) | op) >>> 0;
const r = (b, a, f, d, hi = 0) =>
  ((hi << 25) | (b << 20) | (a << 15) | (f << 12) | (d << 7) | 0x33) >>> 0;
const s = (imm, b, a, f) =>
  ((((imm & 4095) >>> 5) << 25) |
    (b << 20) |
    (a << 15) |
    (f << 12) |
    ((imm & 31) << 7) |
    0x23) >>>
  0;
const br = (off, b, a, f) => {
  let v = off & 8191;
  return (
    ((((v >>> 12) & 1) << 31) |
      (((v >>> 5) & 63) << 25) |
      (b << 20) |
      (a << 15) |
      (f << 12) |
      (((v >>> 1) & 15) << 8) |
      (((v >>> 11) & 1) << 7) |
      0x63) >>>
    0
  );
};
const jal = (off, d) => {
  let v = off & 0x1fffff;
  return (
    ((((v >>> 20) & 1) << 31) |
      (((v >>> 1) & 1023) << 21) |
      (((v >>> 11) & 1) << 20) |
      (((v >>> 12) & 255) << 12) |
      (d << 7) |
      0x6f) >>>
    0
  );
};
export const presets = [
  {
    id: "sum",
    title: "01 / Sum 1 to 10",
    brief: "A loop, a branch, a result.",
    explain:
      "x1 counts down from 10. x2 accumulates 55 (0x37). The result is stored at 0x400; EBREAK then stops without retiring.",
    expected: "x2 = 55 · RAM[0x400] = 37 00 00 00",
    memory: 0x400,
    words: [
      i(10, 0, 0, 1),
      i(0, 0, 0, 2),
      r(1, 2, 0, 2),
      i(-1, 1, 0, 1),
      br(-8, 0, 1, 1),
      i(1024, 0, 0, 3),
      s(0, 2, 3, 2),
      0x00100073,
    ],
  },
  {
    id: "fibonacci",
    title: "02 / Fibonacci sequence",
    brief: "Registers become a sequence.",
    explain:
      "Twelve Fibonacci values, starting 0, 1, are written as little-endian words from 0x400. x2 ends at 144; x3 ends at 233.",
    expected: "RAM[0x400…0x42f] = 0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89",
    memory: 0x400,
    words: [
      i(1024, 0, 0, 1),
      i(0, 0, 0, 2),
      i(1, 0, 0, 3),
      i(12, 0, 0, 4),
      s(0, 2, 1, 2),
      r(3, 2, 0, 5),
      i(0, 3, 0, 2),
      i(0, 5, 0, 3),
      i(4, 1, 0, 1),
      i(-1, 4, 0, 4),
      br(-24, 0, 4, 1),
      0x00100073,
    ],
  },
  {
    id: "bytes",
    title: "03 / Signed bytes",
    brief: "The same byte, two meanings.",
    explain:
      "Store -128 as one byte. LB sign-extends it to 0xffffff80; LBU zero-extends it to 0x00000080. Shift and store the signed result too.",
    expected: "x3 = ffffff80 · x4 = 00000080 · x5 = ffffffff",
    memory: 0x400,
    words: [
      i(1024, 0, 0, 1),
      i(-128, 0, 0, 2),
      s(0, 2, 1, 0),
      i(0, 1, 0, 3, 3),
      i(0, 1, 4, 4, 3),
      i((32 << 5) | 7, 3, 5, 5),
      s(4, 3, 1, 2),
      0x00100073,
    ],
  },
  {
    id: "call",
    title: "04 / Call and return",
    brief: "A link register brings you home.",
    explain:
      "JAL enters a subroutine at 0x14, saving 0x08 in x1. It adds seven to x10, then JALR returns. Store 42 at 0x400 and stop.",
    expected: "x1 = 00000008 · x10 = 42 · RAM[0x400] = 2a 00 00 00",
    memory: 0x400,
    words: [
      i(35, 0, 0, 10),
      jal(16, 1),
      i(1024, 0, 0, 2),
      s(0, 10, 2, 2),
      0x00100073,
      i(7, 10, 0, 10),
      i(0, 1, 0, 0, 0x67),
    ],
  },
];
export function parseProgram(text) {
  if (text.length > 180000)
    throw Error("Program text exceeds 180,000 characters. Nothing was loaded.");
  const words = [];
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const s = lines[n].split("#")[0].trim();
    if (!s) continue;
    if (!/^[0-9a-fA-F]{8}$/.test(s))
      throw Error(
        `Line ${n + 1}: use exactly eight hexadecimal digits, optionally followed by a # comment. Nothing was loaded.`,
      );
    words.push(parseInt(s, 16) >>> 0);
    if (words.length > 16384)
      throw Error("Maximum 16,384 words (64 KiB). Nothing was loaded.");
  }
  if (!words.length)
    throw Error("Enter at least one 32-bit word. Nothing was loaded.");
  return words;
}
