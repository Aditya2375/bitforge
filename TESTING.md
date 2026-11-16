# Verification

The tests use different failure detectors rather than treating agreement between two copies of one algorithm as proof.

## Native semantics

- `tests/core.c`: 81 known-answer assertions, including all 32 arithmetic shift amounts, overflow, JALR aliasing/bit clearing, x0 faults, exact environment instructions and ignored FENCE reserved fields.
- `tests/traps.c`: directed access/alignment/illegal/environment checks with byte-for-byte register and RAM preservation on traps. Then 200,000 deterministic random instruction words exercise the decoder under AddressSanitizer and UndefinedBehaviorSanitizer. Assertion count depends on the deterministic trap/retire split; the current corpus yields 786,685 assertions.
- `tests/differential.py`: 256 cases per nontrapping instruction, all 38 names, for 9,728 comparisons with the independent Unicorn 2.1.4 RV32 backend. Each comparison checks all 32 registers, PC, all RAM bytes, and native retirement/status expectations. Inputs include signed/unsigned boundaries, random registers, rd/rs aliasing, all shift amounts, positive/negative immediates, taken/not-taken branches and valid RAM operations. Translation caches are explicitly cleared when replacing code.

Unicorn's platform, extensions and trap environment are not claimed to match bitforge. Only valid nontrapping RV32I cases are compared there. Traps are tested separately against the declared EEI. No Sail, RISCOF or riscv-tests suite was run, and these results are not certification.

## Same core, two hosts

`tests/web.mjs` executes all four example programs in the embedded WebAssembly core and the native CLI. It compares final PC, status, trap value, retirement, all 32 registers and the 64-byte output RAM page. Independent expected values check sum 55, the twelve Fibonacci writes, signed versus unsigned byte loads and the call's result 42. This parity check is not a full-RAM comparison; the independent native/Unicorn suite above performs that check.

The same script tests empty, malformed and oversized programs, native line/step bounds, comment handling, a budget-limited infinite loop and 100,000 random words for browser disassembly legality against C. The pinned compiler rebuild gate checks that the embedded WebAssembly bytes match the committed original C sources.

## Browser behavior

`tests/browser.mjs` runs Chromium against a local static server or `BITFORGE_URL`. It checks real stepping and preset outputs, breakpoint re-entry and an initial PC-zero breakpoint, reset, signed display, invalid-input retention, load alignment, budget/pause, RAM page bounds and a high-bit PC access fault. It checks no document overflow, heading line counts and control heights at widths 320, 375, 768, 1024 and 1440. Page errors and failed requests fail the run. Screenshots go to `build/screenshots` or `BITFORGE_SHOTS`.

The browser checks require actual image review for layout judgment. Automated DOM checks alone do not establish visual correctness. Native Safari, Firefox and Android devices have not been tested. No claim is made about cycle timing, operating-system compatibility, multi-hart ordering, privilege modes, devices or unsupported extensions.

## Development dependencies

C core and native tests need only a C11 compiler and Make. Python differential tests need `unicorn==2.1.4`; browser tests use the locked `@playwright/test` dependency and downloaded Chromium. CI pins action commits, the LLVM toolchain source commit/release, Gitleaks binary hash and Semgrep version. Not every transitive development package is hash-pinned. Runtime has no third-party JavaScript, fonts or fetched datasets.
