import { bytes } from "./core.js";
import { hex, decode, presets, parseProgram } from "./isa.js";
const $ = (id) => document.getElementById(id);
const abi = [
  "zero",
  "ra",
  "sp",
  "gp",
  "tp",
  "t0",
  "t1",
  "t2",
  "s0/fp",
  "s1",
  "a0",
  "a1",
  "a2",
  "a3",
  "a4",
  "a5",
  "a6",
  "a7",
  "s2",
  "s3",
  "s4",
  "s5",
  "s6",
  "s7",
  "s8",
  "s9",
  "s10",
  "s11",
  "t3",
  "t4",
  "t5",
  "t6",
];
const traps = [
  "Running",
  "Instruction alignment",
  "Instruction access",
  "Illegal instruction",
  "Load alignment",
  "Load access",
  "Store alignment",
  "Store access",
  "Environment call",
  "Breakpoint trap",
];
let cpu,
  words = [],
  running = false,
  mode = "Ready",
  generation = 0,
  attempts = 0,
  last = null,
  history = [],
  breakpoints = new Set(),
  memoryPage = 0x400,
  listingPage = 0;
const regNodes = [];
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
for (const p of presets) {
  const o = el("option", p.title);
  o.value = p.id;
  $("preset").append(o);
}
for (let i = 0; i < 32; i++) {
  const node = el("div", undefined, "register" + (!i ? " zero" : ""));
  const label = el("div", undefined, "reg-label");
  label.append(el("span", `x${i}`), el("span", abi[i]));
  const value = el("div", "00000000", "reg-value");
  node.append(label, value);
  $("registers").append(node);
  regNodes.push({ node, value });
}
const customOption = el("option", "Custom machine code");
customOption.value = "custom";
customOption.disabled = true;
$("preset").append(customOption);
function getWord(a) {
  return (
    (cpu.byte_at(a) |
      (cpu.byte_at(a + 1) << 8) |
      (cpu.byte_at(a + 2) << 16) |
      (cpu.byte_at(a + 3) << 24)) >>>
    0
  );
}
function format(v) {
  return $("number-format").value === "signed"
    ? String(v | 0)
    : $("number-format").value === "unsigned"
      ? String(v >>> 0)
      : hex(v);
}
function event() {
  return {
    pc: cpu.field(0),
    word: cpu.field(1),
    next: cpu.field(2),
    rd: cpu.field(3),
    before: cpu.field(4),
    after: cpu.field(5),
    address: cpu.field(6),
    width: cpu.field(7),
    loaded: cpu.field(8),
    stored: cpu.field(9),
    taken: cpu.field(10),
    status: cpu.field(11),
    tval: cpu.field(12),
    retired: cpu.field(13),
    memoryBefore: cpu.field(14),
    memoryAfter: cpu.field(15),
  };
}
function effect(e) {
  if (e.status)
    return `${traps[e.status]} · tval ${hex(e.tval)} · no instruction retired`;
  if (e.stored)
    return `store ${e.width} byte${e.width === 1 ? "" : "s"} at ${hex(e.address)}: ${hex(e.memoryBefore, e.width * 2)} → ${hex(e.memoryAfter, e.width * 2)} · PC → ${hex(e.next)}`;
  if (e.rd < 32)
    return `${e.rd === 0 ? "x0 discards the result" : `x${e.rd}: ${hex(e.before)} → ${hex(e.after)}`}${e.loaded ? ` · load ${e.width}B @ ${hex(e.address)}` : ""} · PC → ${hex(e.next)}`;
  return `${e.taken ? "branch taken" : (e.word & 127) === 0x63 ? "branch not taken" : "no register write"} · PC → ${hex(e.next)}`;
}
function drawListing(follow = false) {
  const pc = cpu.pc();
  if (follow && pc < 65536) listingPage = Math.floor(pc / 256) * 256;
  const end = Math.min(
    65536,
    Math.max(words.length * 4, Math.min(65536, pc + 4)),
  );
  const start = listingPage;
  const frag = document.createDocumentFragment();
  for (let a = start; a < Math.min(end, start + 256); a += 4) {
    const w = getWord(a),
      d = decode(w, a),
      row = el("tr");
    if (a === pc) {
      row.className = "current";
      row.setAttribute("aria-current", "step");
    }
    const td = el("td"),
      button = el("button", "●", "breakpoint");
    button.type = "button";
    button.setAttribute("aria-label", `Toggle breakpoint at ${hex(a)}`);
    button.setAttribute("aria-pressed", String(breakpoints.has(a)));
    button.addEventListener("click", () => {
      if (breakpoints.has(a)) breakpoints.delete(a);
      else breakpoints.add(a);
      button.setAttribute("aria-pressed", String(breakpoints.has(a)));
    });
    td.append(button);
    row.append(
      td,
      el("td", hex(a)),
      el("td", hex(w)),
      el("td", `${d.name}${d.args ? " " + d.args : ""}`),
    );
    frag.append(row);
  }
  $("listing").replaceChildren(frag);
  $("loaded-count").textContent =
    `${words.length.toLocaleString()} words loaded · page ${hex(start, 4)}`;
  $("listing-prev").disabled = start === 0;
  $("listing-next").disabled = start + 256 >= Math.max(end, words.length * 4);
  if (follow) {
    const current = $("listing").querySelector(".current");
    if (current) {
      const wrap = $("listing").parentElement.parentElement;
      wrap.scrollTop = Math.max(
        0,
        current.getBoundingClientRect().top -
          wrap.getBoundingClientRect().top +
          wrap.scrollTop -
          wrap.clientHeight / 2,
      );
    }
  }
}
function drawMemory() {
  const frag = document.createDocumentFragment();
  for (let a = memoryPage; a < memoryPage + 64; a += 8) {
    const row = el("tr");
    row.append(el("td", hex(a)));
    for (let j = 0; j < 8; j++) {
      const addr = a + j,
        value = cpu.byte_at(addr),
        td = el("td", hex(value, 2));
      if (value) td.className = "nonzero";
      if (
        last &&
        !last.status &&
        (last.loaded || last.stored) &&
        addr >= last.address &&
        addr < last.address + last.width
      )
        td.classList.add("touched");
      row.append(td);
    }
    frag.append(row);
  }
  $("memory").replaceChildren(frag);
  $("memory-caption").textContent =
    `RAM / ${hex(memoryPage)}-${hex(memoryPage + 63)}`;
  $("memory-prev").disabled = memoryPage === 0;
  $("memory-next").disabled = memoryPage === 0xffc0;
}
function drawTrace() {
  const frag = document.createDocumentFragment();
  for (const e of history) {
    const li = el("li"),
      line = el("div", undefined, "trace-code"),
      d =
        e.status === 2 || (e.status === 1 && e.pc & 3)
          ? { name: "fetch fault", args: "" }
          : decode(e.word, e.pc);
    line.append(el("span", hex(e.pc)), el("span", `${d.name} ${d.args}`));
    li.append(line, el("span", effect(e), "trace-effect"));
    frag.append(li);
  }
  if (!history.length)
    frag.append(el("li", "No instructions executed yet.", "empty"));
  $("trace").replaceChildren(frag);
  $("trace-count").textContent =
    `${history.length} event${history.length === 1 ? "" : "s"}`;
}
function render(follow = true) {
  const pc = cpu.pc(),
    accessible = pc <= 65532 && (pc & 3) === 0,
    w = accessible ? getWord(pc) : 0,
    d = decode(w, pc),
    state = cpu.status();
  $("pc").textContent = hex(pc);
  $("position").textContent = `PC ${hex(pc)}`;
  $("word").textContent = accessible ? hex(w) : "unavailable";
  $("retired").textContent = cpu.retired().toLocaleString();
  $("machine-state").textContent = state
    ? state === 9
      ? "EBREAK"
      : traps[state]
    : mode;
  $("instruction-kind").textContent = accessible
    ? d.kind
    : "No accessible instruction";
  $("instruction").textContent = accessible ? d.name : "fault";
  $("instruction-args").textContent = accessible
    ? d.args
    : `0x${hex(pc)} is outside aligned instruction memory.`;
  $("bits").textContent = accessible
    ? [
        w >>> 25,
        (w >>> 20) & 31,
        (w >>> 15) & 31,
        (w >>> 12) & 7,
        (w >>> 7) & 31,
        w & 127,
      ]
        .map((v, i) => v.toString(2).padStart([7, 5, 5, 3, 5, 7][i], "0"))
        .join(" ")
    : "No word available";
  $("receipt").textContent = last
    ? effect(last)
    : "Step to see the exact state change.";
  for (let i = 0; i < 32; i++) {
    regNodes[i].value.textContent = format(cpu.reg(i));
    regNodes[i].node.classList.toggle(
      "written",
      Boolean(last && !last.status && last.rd === i && i !== 0),
    );
  }
  $("run").textContent = running ? "Pause Ⅱ" : "Run ▶";
  $("run").disabled = Boolean(state);
  $("step").disabled = running || Boolean(state);
  $("load").disabled = running;
  $("preset").disabled = running;
  $("reset").disabled = false;
  drawListing(follow);
  drawMemory();
  drawTrace();
}
function notify(text, fault = false) {
  $("notice").textContent = text;
  $("notice").classList.toggle("fault", fault);
}
function stoppedNotice() {
  const state = cpu.status();
  if (state === 9)
    notify(
      `EBREAK at 0x${hex(cpu.pc())}. Intentional breakpoint trap; ${cpu.retired()} instructions retired. Reset reloads the program.`,
    );
  else
    notify(
      `${traps[state]} at PC 0x${hex(cpu.pc())}; tval 0x${hex(cpu.tval())}. No state change from this instruction. Reset to restart.`,
      true,
    );
}
function pause() {
  running = false;
  generation++;
}
function initialize(newWords, clearBreaks = true) {
  pause();
  words = newWords.slice();
  cpu.reset();
  for (let i = 0; i < words.length; i++)
    for (let b = 0; b < 4; b++)
      cpu.poke(i * 4 + b, (words[i] >>> (8 * b)) & 255);
  history = [];
  last = null;
  attempts = 0;
  mode = "Ready";
  listingPage = 0;
  if (clearBreaks) breakpoints.clear();
  render();
  notify(
    `Ready at 0x00000000. ${words.length} words loaded. Step once or run to EBREAK.`,
  );
}
function selectPreset() {
  const p = presets.find((p) => p.id === $("preset").value);
  if (!p) return;
  $("program-brief").textContent = p.brief;
  $("program-explain").textContent = p.explain;
  $("expected").textContent = p.expected;
  $("program-input").value = p.words
    .map(
      (w, j) =>
        `${hex(w)} # ${hex(j * 4, 4)} ${decode(w, j * 4).name} ${decode(w, j * 4).args}`,
    )
    .join("\n");
  $("input-error").textContent = "";
  $("memory-error").textContent = "";
  memoryPage = p.memory;
  $("memory-address").value = hex(memoryPage, 4);
  initialize(p.words);
}
function execute() {
  cpu.step();
  last = event();
  history.unshift(last);
  if (history.length > 32) history.pop();
  attempts++;
  return cpu.status();
}
$("step").addEventListener("click", () => {
  if (!cpu || running || cpu.status()) return;
  const state = execute();
  mode = "Paused";
  render();
  if (state) stoppedNotice();
  else
    notify(
      `Stepped one instruction. PC 0x${hex(cpu.pc())}; ${cpu.retired()} retired.`,
    );
});
$("run").addEventListener("click", () => {
  if (!cpu) return;
  if (running) {
    pause();
    mode = "Paused";
    render();
    notify(`Paused at 0x${hex(cpu.pc())}; ${cpu.retired()} retired.`);
    return;
  }
  if (cpu.status()) return;
  const skip =
    mode === "Breakpoint" && breakpoints.has(cpu.pc()) ? cpu.pc() : null;
  running = true;
  mode = "Running";
  const token = ++generation,
    start = attempts;
  let first = true;
  render(false);
  notify("Running locally, up to 10,000 instructions. Pause at any time.");
  function batch() {
    if (!running || generation !== token) return;
    for (let j = 0; j < 64; j++) {
      if (breakpoints.has(cpu.pc()) && !(first && cpu.pc() === skip)) {
        pause();
        mode = "Breakpoint";
        render();
        notify(
          `Paused before breakpoint at 0x${hex(cpu.pc())}. Step or Run continues past it once.`,
        );
        return;
      }
      first = false;
      if (execute()) {
        pause();
        mode = "Stopped";
        render();
        stoppedNotice();
        return;
      }
      if (attempts - start >= 10000) {
        pause();
        mode = "Budget reached";
        render();
        notify(
          `Run paused after 10,000 attempted instructions at 0x${hex(cpu.pc())}. You can inspect, Step or Run again.`,
        );
        return;
      }
    }
    render();
    requestAnimationFrame(batch);
  }
  requestAnimationFrame(batch);
});
$("reset").addEventListener("click", () => {
  if (cpu) {
    initialize(words, false);
    notify(
      "Reset: program reloaded, all registers and other RAM cleared. Breakpoints kept.",
    );
  }
});
$("preset").addEventListener("change", selectPreset);
$("number-format").addEventListener("change", () => {
  if (cpu) render(false);
});
$("load").addEventListener("click", () => {
  if (!cpu || running) return;
  try {
    const program = parseProgram($("program-input").value);
    $("input-error").textContent = "";
    $("preset").value = "custom";
    $("program-brief").textContent =
      "Custom machine code / 0x00000000 entry point";
    $("program-explain").textContent =
      "Your program runs in the same bounded 64 KiB machine. No assembly, system calls or host access. EBREAK (00100073) is a convenient stopping instruction.";
    $("expected").textContent =
      "Custom program: results depend on the words you load.";
    initialize(program);
    $("editor").open = false;
  } catch (error) {
    $("input-error").textContent = error.message;
  }
});
$("memory-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("memory-address").value.trim();
  if (!/^(0x)?[0-9a-fA-F]{1,8}$/.test(text) || parseInt(text, 16) > 0xffff) {
    $("memory-error").textContent =
      "Enter a hex address from 0000 to ffff. The previous page is unchanged.";
    return;
  }
  memoryPage = Math.floor(parseInt(text, 16) / 64) * 64;
  $("memory-address").value = hex(memoryPage, 4);
  $("memory-error").textContent = "";
  if (cpu) drawMemory();
});
for (const [id, delta] of [
  ["memory-prev", -64],
  ["memory-next", 64],
])
  $(id).addEventListener("click", () => {
    if (!cpu) return;
    memoryPage = Math.max(0, Math.min(0xffc0, memoryPage + delta));
    $("memory-address").value = hex(memoryPage, 4);
    $("memory-error").textContent = "";
    drawMemory();
  });
for (const [id, delta] of [
  ["listing-prev", -256],
  ["listing-next", 256],
])
  $(id).addEventListener("click", () => {
    if (!cpu) return;
    listingPage = Math.max(0, Math.min(0xff00, listingPage + delta));
    drawListing(false);
  });
try {
  if (!globalThis.WebAssembly) throw Error("WebAssembly is unavailable");
  const result = await WebAssembly.instantiate(bytes, {});
  cpu = Object.fromEntries(
    Object.entries(result.instance.exports)
      .filter(([, v]) => typeof v === "function")
      .map(([k, f]) => [k, (...args) => f(...args) >>> 0]),
  );
  $("runtime").textContent = "C → WASM / LOCAL";
  selectPreset();
} catch (error) {
  $("runtime").textContent = "Core unavailable";
  notify(
    "The WebAssembly core could not start. Use a current browser with WebAssembly enabled, or build the native C CLI from the source.",
    true,
  );
  for (const id of [
    "reset",
    "step",
    "run",
    "load",
    "preset",
    "listing-prev",
    "listing-next",
    "memory-prev",
    "memory-next",
  ])
    $(id).disabled = true;
}
