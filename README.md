# bitforge

An original C11 RV32I CPU emulator with a WebAssembly debugger. Execute real machine words, follow every register write and inspect every byte. The native CLI and browser use the same execution core.

## In the browser

Serve `docs/` with any static HTTP server:

```sh
python3 -m http.server 8000 --directory docs
```

Open `http://localhost:8000`. No build or runtime dependency download is needed for the browser lab. A current browser with JavaScript and WebAssembly is required.

- Step, run, pause and reset. Runs stop after at most 10,000 attempted instructions.
- Break before an instruction at a selected PC. Resume bypasses that stop once, then catches the next visit.
- Inspect all 32 registers in hexadecimal, signed decimal or unsigned decimal.
- See current disassembly, raw encoding fields and the last instruction's exact effects.
- Inspect any 64-byte page in the 64 KiB RAM. Follow the latest memory access.
- Read the last 32 attempted instructions, including precise traps.
- Load your own machine words, or explore four programs: a summation loop, Fibonacci writes, signed byte loads, and a subroutine call.

The instruction listing is paged in groups of 64 words and follows the PC while stepping. RAM is executable and writable; the listing reads the current RAM, including self-modifications. A debugger breakpoint is a host-side pause before execution. The EBREAK instruction is different: it produces a sticky trap and requires Reset.

## Native CLI

A C11 compiler and Make are enough. No third-party runtime library.

```sh
make
printf '00a00093\n00100073\n' > example.hex
./build/bitforge example.hex 1000
```

The file format is exactly eight hexadecimal digits per nonempty line, optionally followed by a `#` comment. Native input lines are limited to 254 characters, excluding the newline. Up to 16,384 words load at address zero. Empty or invalid input fails before execution. This is a hex-word loader, not an assembler or ELF loader.

The optional instruction-attempt limit is an integer from 1 through 1,000,000; the default is 100,000. Output is JSON with PC, internal trap status/value, retired count, all registers, and 64 bytes of RAM starting at `0x400`. Exit codes: `0` for EBREAK, `1` for input or file errors, `2` for any other emulated trap, `3` for a reached instruction budget. Registers and JSON numbers are unsigned 32-bit values.

## Machine contract

See [ARCHITECTURE.md](ARCHITECTURE.md) for all supported instructions, trap precedence and execution-environment choices.

RV32I v2.1, little endian, one hart, 32 integer registers and 64 KiB of flat RAM. All 40 base instructions are handled; FENCE is a no-op in this single-hart, no-device environment. ECALL and EBREAK stop at the instruction without retirement. Natural data misalignment is a fatal trap. Reserved and unsupported encodings are illegal.

This is an instruction-level emulator, not a cycle-accurate processor or a full privileged computer. No CSRs, interrupts, devices, compressed instructions, multiplication, atomics, floating point, host syscalls or operating system. No ISA certification claim.

## Verify

```sh
make test                    # known answers, precise traps, 200,000 decoder samples
make sanitize                # AddressSanitizer + UndefinedBehaviorSanitizer
make clean all               # rebuild without sanitizer instrumentation
python3 -m pip install unicorn==2.1.4
make differential            # independent, test-only RV32 backend
npm ci --ignore-scripts
npm test                     # native/WASM examples, input and decoder checks
npx playwright install chromium
npm run test:browser          # real browser interactions and responsive checks
```

The differential suite compares all registers, PC and all 65,536 RAM bytes against Unicorn 2.1.4 for 9,728 single-step cases across the 38 nontrapping base instructions. Directed tests cover the remaining ECALL/EBREAK instructions and this emulator's trap environment. Unicorn is used only for testing; it is not bundled or called by the product. See [TESTING.md](TESTING.md) for coverage and limits.

To rebuild the embedded WebAssembly module, set `WASM_CC` to a clang supporting `wasm32`:

```sh
WASM_CC=/path/to/clang python3 tools/build-wasm.py
```

The checked-in `docs/core.js` was built with the LLVM in Emscripten 6.0.13. CI rebuilds with that toolchain and checks the generated module byte for byte. A different compiler version may emit different bytes with the same behavior.

## Privacy and security

All emulated programs stay in the page. No upload, telemetry, cookies, local storage or runtime network API. Input is machine data interpreted by the bounded C core, never evaluated as JavaScript. WebAssembly memory is fixed at 192 KiB; only 64 KiB is emulated RAM. The static page uses a restrictive CSP with the specific WebAssembly compilation allowance, no inline scripts or styles, and no network connections from the application.

Test and build tools install their pinned development dependencies over the network. That is separate from the offline application runtime. GitHub Pages hosting itself receives normal page/asset requests.

## References and license

- [RISC-V RV32I v2.1 specification](https://docs.riscv.org/reference/isa/v20260120/unpriv/rv32.html): governing instruction semantics.
- [RISC-V ISA Explorer](https://tech.riscv.org/isa-explorer/ext/rv32i/): instruction encodings.
- [Unicorn Engine](https://www.unicorn-engine.org/): independent test-only emulator.

Original source and artwork are available under **MIT OR Apache-2.0**, at your option. See [LICENSE-MIT](LICENSE-MIT) and [LICENSE-APACHE](LICENSE-APACHE). Third-party test tools retain their own licenses. No external ISA implementation or test-suite code is bundled.
