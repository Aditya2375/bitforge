"""Test-only oracle: compare original C core with Unicorn 2.1.4's RV32 backend.
No Unicorn code is distributed or used by the native program or browser.
"""

import ctypes as C
import random
from unicorn import Uc, UC_ARCH_RISCV, UC_MODE_RISCV32
from unicorn.riscv_const import UC_RISCV_REG_X0, UC_RISCV_REG_PC


class Machine(C.Structure):
    _fields_ = [
        ("x", C.c_uint32 * 32),
        ("pc", C.c_uint32),
        ("status", C.c_uint32),
        ("tval", C.c_uint32),
        ("retired", C.c_uint32),
        ("ram", C.c_ubyte * 65536),
    ]


class Event(C.Structure):
    _fields_ = [
        (n, C.c_uint32)
        for n in "pc word next_pc rd before after address width loaded stored taken status tval retired memory_before memory_after".split()
    ]


core = C.CDLL("./build/libbitforge.so")
core.bf_step.argtypes = [C.POINTER(Machine), C.POINTER(Event)]
core.bf_step.restype = C.c_uint32
rng = random.Random(0xB17F032)
mask = (1 << 32) - 1
u = Uc(UC_ARCH_RISCV, UC_MODE_RISCV32)
u.mem_map(0, 65536)
base = bytes(rng.getrandbits(8) for _ in range(65536))
edge = [0, 1, 31, 32, 63, 127, 128, 255, 256, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFE, mask]
count = 0
coverage = {}


def execute(name, w, regs, pc=0x100):
    global count
    m = Machine()
    m.pc = pc
    C.memmove(C.addressof(m) + Machine.ram.offset, base, len(base))
    m.ram[pc : pc + 4] = w.to_bytes(4, "little")
    for i in range(32):
        m.x[i] = regs[i] if i else 0
    u.mem_write(0, bytes(m.ram))
    # Clear TB cache: each case may replace the instruction at the same PC.
    u.ctl_remove_cache(0, 65536)
    for i in range(32):
        u.reg_write(UC_RISCV_REG_X0 + i, m.x[i])
    before_memory = bytes(m.ram)
    e = Event()
    ret = core.bf_step(C.byref(m), C.byref(e))
    if ret:
        raise AssertionError((name, hex(w), "unexpected C trap", ret))
    u.emu_start(pc, 65536, count=1)
    other = [u.reg_read(UC_RISCV_REG_X0 + i) & mask for i in range(32)]
    assert list(m.x) == other, (name, hex(w), list(m.x), other)
    assert m.pc == (u.reg_read(UC_RISCV_REG_PC) & mask), (
        name,
        hex(w),
        "pc",
        hex(m.pc),
        hex(u.reg_read(UC_RISCV_REG_PC)),
    )
    assert bytes(m.ram) == bytes(u.mem_read(0, 65536)), (name, hex(w), "memory")
    assert m.retired == 1 and m.status == 0
    if e.stored:
        assert e.memory_before == int.from_bytes(
            before_memory[e.address : e.address + e.width], "little"
        )
        assert e.memory_after == int.from_bytes(
            bytes(m.ram[e.address : e.address + e.width]), "little"
        )
    count += 1
    coverage[name] = coverage.get(name, 0) + 1


for rep in range(256):
    regs = [rng.choice(edge) if rep < 128 else rng.getrandbits(32) for _ in range(32)]
    regs[0] = 0
    rd = rng.randrange(32)
    a = rng.randrange(32)
    b = rng.randrange(32)
    for f7, f3, name in [
        (0, 0, "add"),
        (32, 0, "sub"),
        (0, 1, "sll"),
        (0, 2, "slt"),
        (0, 3, "sltu"),
        (0, 4, "xor"),
        (0, 5, "srl"),
        (32, 5, "sra"),
        (0, 6, "or"),
        (0, 7, "and"),
    ]:
        execute(name, f7 << 25 | b << 20 | a << 15 | f3 << 12 | rd << 7 | 0x33, regs)
    imm = rng.randrange(4096)
    for f3, name in [
        (0, "addi"),
        (2, "slti"),
        (3, "sltiu"),
        (4, "xori"),
        (6, "ori"),
        (7, "andi"),
    ]:
        execute(name, imm << 20 | a << 15 | f3 << 12 | rd << 7 | 0x13, regs)
    for f7, f3, name in [(0, 1, "slli"), (0, 5, "srli"), (32, 5, "srai")]:
        execute(
            name,
            f7 << 25 | (rep % 32) << 20 | a << 15 | f3 << 12 | rd << 7 | 0x13,
            regs,
        )
    for op, name in [(0x37, "lui"), (0x17, "auipc")]:
        execute(name, rng.getrandbits(20) << 12 | rd << 7 | op, regs)
    off = rng.choice([-128, -4, 0, 4, 124])
    z = off & 8191
    for f3, name in [
        (0, "beq"),
        (1, "bne"),
        (4, "blt"),
        (5, "bge"),
        (6, "bltu"),
        (7, "bgeu"),
    ]:
        w = (
            ((z >> 12) & 1) << 31
            | ((z >> 5) & 63) << 25
            | b << 20
            | a << 15
            | f3 << 12
            | ((z >> 1) & 15) << 8
            | ((z >> 11) & 1) << 7
            | 0x63
        )
        execute(name, w, regs)
    z = off & 0x1FFFFF
    execute(
        "jal",
        ((z >> 20) & 1) << 31
        | ((z >> 1) & 1023) << 21
        | ((z >> 11) & 1) << 20
        | ((z >> 12) & 255) << 12
        | rd << 7
        | 0x6F,
        regs,
    )
    safe = regs.copy()
    a = rng.randrange(1, 32)
    safe[a] = 0x180 + (rep & 1)
    imm = rng.choice([-128, -4, 0, 4, 124]) & 4095
    execute("jalr", imm << 20 | a << 15 | rd << 7 | 0x67, safe)
    for f3, name, size in [
        (0, "lb", 1),
        (1, "lh", 2),
        (2, "lw", 4),
        (4, "lbu", 1),
        (5, "lhu", 2),
    ]:
        safe = regs.copy()
        offset = rng.randrange(-2048, 2048)
        target = rng.randrange(0x200, 0xF000) // size * size
        safe[a] = (target - offset) & mask
        execute(name, (offset & 4095) << 20 | a << 15 | f3 << 12 | rd << 7 | 3, safe)
    for f3, name, size in [(0, "sb", 1), (1, "sh", 2), (2, "sw", 4)]:
        safe = regs.copy()
        offset = rng.randrange(-2048, 2048) & 4095
        target = rng.randrange(0x200, 0xF000) // size * size
        signed = offset - 4096 if offset & 2048 else offset
        safe[a] = (target - signed) & mask
        execute(
            name,
            ((offset >> 5) << 25)
            | b << 20
            | a << 15
            | f3 << 12
            | ((offset & 31) << 7)
            | 0x23,
            safe,
        )
    execute("fence", 0x0FF0000F, regs)
assert len(coverage) == 38
print(
    f"{count} full-state C/Unicorn comparisons; {len(coverage)} nontrapping RV32I instructions; 256 cases each"
)
