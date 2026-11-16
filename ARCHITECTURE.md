# Machine contract

## State and execution

`Machine` contains 32 unsigned 32-bit register words, PC, sticky internal status, trap value, a 32-bit retired counter, and 65,536 RAM bytes. Reset clears all state. x0 reads zero and ignores writes. Arithmetic and addresses wrap modulo 2^32. The retired counter also wraps modulo 2^32; it is diagnostic state, not an implemented CSR.

The one-step C API returns a complete event: original PC/word, next PC, optional destination register and its before/after values, memory address/width, load/store flags, store data before/after values, taken flag, status, trap value and retired count. Register number 32 means no destination. A failed fetch has no instruction word; callers must check the trap status instead of decoding its zero event field as an executed instruction.

The core reads source operands before any destination write. It validates decode, target alignment and data accesses before changing architectural registers, PC, RAM or retired count. A trapping instruction leaves those fields unchanged. Internal status and trap value record the trap; subsequent steps retain that status until Reset.

RAM is little endian, readable, writable and executable throughout. There are no devices, protection regions or memory-mapped services. A store to code is immediately visible to the next fetch. The only memory model being represented is this single sequential hart. Nothing here models caches, pipelines, cycles or competing agents.

## Instruction surface

| Group | Instructions |
| --- | --- |
| Upper immediate | LUI, AUIPC |
| Register integer | ADD, SUB, SLL, SLT, SLTU, XOR, SRL, SRA, OR, AND |
| Immediate integer | ADDI, SLTI, SLTIU, XORI, ORI, ANDI, SLLI, SRLI, SRAI |
| Branch | BEQ, BNE, BLT, BGE, BLTU, BGEU |
| Jump | JAL, JALR |
| Load | LB, LH, LW, LBU, LHU |
| Store | SB, SH, SW |
| Ordering | FENCE |
| Environment | ECALL, EBREAK |

These are the 40 base instructions in RV32I v2.1. FENCE's reserved `fm`, `rs1`, `rd` and predecessor/successor settings are ignored as required for a base implementation, including conservative acceptance of FENCE.TSO. FENCE has no observable effect in this single-hart, no-device environment beyond PC/retirement. FENCE.I is a separate extension and is illegal here. HINTs encoded as normal base instructions run normally, discarding writes to x0.

JALR adds the signed 12-bit immediate to the original rs1, clears target bit zero, then requires four-byte alignment. Signed comparisons use two's-complement order. SLTIU first sign-extends its immediate, then compares unsigned words. Register shifts use only the low five bits of rs2; arithmetic right shifts explicitly replicate the sign bit without relying on C's signed-right-shift behavior.

## Execution environment and traps

The status numbers below belong to bitforge, not RISC-V `mcause`. No trap handler or CSR is implemented.

| Status | Meaning | Trap value |
| --- | --- | --- |
| 0 | Ready/running | zero |
| 1 | Instruction address misaligned | bad target or fetch PC |
| 2 | Instruction access fault | fetch PC outside RAM |
| 3 | Illegal instruction | full instruction word |
| 4 | Load address misaligned | effective address |
| 5 | Load access fault | effective address |
| 6 | Store address misaligned | effective address |
| 7 | Store access fault | effective address |
| 8 | Environment call | zero |
| 9 | Breakpoint instruction | zero |

Instruction alignment is four bytes. A taken branch or jump with a misaligned target traps at the branch/jump, without committing a link. A conditional branch that is not taken does not check target alignment. An aligned out-of-RAM target is different: the branch/jump commits normally and the following target fetch faults. Its link write and retirement remain committed.

Data bytes may use any address; halfwords require even addresses and words require a multiple of four. When an effective data address is both misaligned and outside RAM, alignment wins in this execution environment. A valid-width load into x0 still checks alignment and access. Stores never partially commit.

ECALL has no host-service ABI and traps. EBREAK traps as a deliberate end marker in the examples. Neither advances PC nor increments retired count. Reset is the only recovery path in this model. Reserved instruction encodings are rejected under a declared strict-illegal policy; the base specification leaves their general behavior unspecified.

## Host boundary

The browser embeds the generated WebAssembly bytes in a local JavaScript module. The module has no imports. Its linear memory has a fixed initial and maximum size of three 64 KiB pages, including C stack/static state. Emulated RAM is a separate 64 KiB array inside it. Public accessors check every emulated address; machine words cannot address the host C stack or run host instructions.

WebAssembly integer return values cross into JavaScript as signed i32, so the browser wrapper normalizes all exported function results to unsigned words before address checks and presentation. The display decoder does not execute instructions. A 100,000-word randomized test compares its legality decisions with the C core; native/WASM program tests compare execution results.

The browser bounds runs to 10,000 attempted instructions in batches of at most 64 per animation frame. It retains only 32 trace events and renders at most 64 instruction rows. Breakpoints are host-side set entries, never modifications to machine code. Reset reloads the original program and clears other RAM/registers, keeping breakpoints. Choosing or loading a program clears breakpoints.
