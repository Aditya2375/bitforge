#include "machine.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static Machine m, before;
static Event e;
static unsigned checks;
#define OK(x)                                                                                      \
    do {                                                                                           \
        checks++;                                                                                  \
        if (!(x)) {                                                                                \
            fprintf(stderr, "failed line%d: %s\n", __LINE__, #x);                                  \
            exit(1);                                                                               \
        }                                                                                          \
    } while (0)
static void word(uint32_t w) {
    for (unsigned i = 0; i < 4; i++)
        m.ram[m.pc + i] = (uint8_t)(w >> (8 * i));
}
static void reset(uint32_t w) {
    bf_reset(&m);
    m.pc = 0x100;
    word(w);
}
static void fault(uint32_t kind, uint32_t val) {
    before = m;
    uint32_t got = bf_step(&m, &e);
    if (got != kind)
        fprintf(stderr, "word=%08x pc=%08x expected=%u got=%u r1=%08x\n", e.word, before.pc, kind,
                got, before.x[1]);
    OK(got == kind);
    OK(m.tval == val);
    OK(m.pc == before.pc);
    OK(m.retired == before.retired);
    OK(!memcmp(m.ram, before.ram, BF_RAM));
    OK(!memcmp(m.x, before.x, sizeof(m.x)));
    OK(bf_step(&m, &e) == kind);
}
int main(void) {
    /* Loads to x0 must not skip address checks; all natural widths, boundaries. */
    for (unsigned f = 0; f < 8; f++) {
        if (f == 3 || f == 6 || f == 7)
            continue;
        unsigned width = (f == 0 || f == 4) ? 1 : (f == 1 || f == 5) ? 2 : 4;
        reset(1u << 15 | f << 12 | 3);
        m.x[1] = BF_RAM;
        fault(BF_LOAD_ACCESS, BF_RAM);
        reset(1u << 15 | f << 12 | 2u << 7 | 3);
        m.x[1] = BF_RAM - width;
        OK(!bf_step(&m, &e));
        OK(m.pc == 0x104);
        if (width > 1) {
            reset(1u << 15 | f << 12 | 3);
            m.x[1] = BF_RAM + 1;
            fault(BF_LOAD_ALIGN, BF_RAM + 1);
        }
    }
    for (unsigned f = 0; f < 3; f++) {
        reset(2u << 20 | 1u << 15 | f << 12 | 0x23);
        m.x[1] = BF_RAM;
        m.x[2] = 0xabcdef01;
        fault(BF_STORE_ACCESS, BF_RAM);
        if (f) {
            reset(2u << 20 | 1u << 15 | f << 12 | 0x23);
            m.x[1] = BF_RAM - 1;
            fault(BF_STORE_ALIGN, BF_RAM - 1);
        }
    }
    /* JAL commits link before a later inaccessible-target fetch; not on misalignment. */
    reset(0x002000efu);
    fault(BF_INST_ALIGN, 0x102);
    reset(0x000080e7u);
    m.x[1] = 0x10000;
    OK(!bf_step(&m, &e));
    OK(m.x[1] == 0x104 && m.pc == 0x10000);
    fault(BF_INST_ACCESS, 0x10000);
    reset(0x00000163u);
    fault(BF_INST_ALIGN, 0x102); /* beq x0,x0,+2 */
    reset(0x00001163u);
    OK(!bf_step(&m, &e));
    OK(m.pc == 0x104); /* bne not taken */
    reset(0x00000073u);
    fault(BF_ECALL, 0);
    reset(0x00100073u);
    fault(BF_BREAK, 0);
    bf_reset(&m);
    m.pc = 2;
    fault(BF_INST_ALIGN, 2);
    bf_reset(&m);
    m.pc = 0xfffffffc;
    fault(BF_INST_ACCESS, 0xfffffffc);
    uint32_t bad[] = {0,          0xffffffff, 0x02000033, 0x0000100f, 0x00001073, 0x00200073,
                      0x02001013, 0x40001033, 0x00003003, 0x00003023, 0x00002063, 0x00001067};
    for (unsigned i = 0; i < sizeof(bad) / sizeof(*bad); i++) {
        reset(bad[i]);
        fault(BF_ILLEGAL, bad[i]);
    }
    /* 12-bit signed offset wraps modulo XLEN before RAM checking. */
    reset(0xfff08083);
    m.x[1] = 0;
    m.ram[BF_RAM - 1] = 0x80;
    fault(BF_LOAD_ACCESS, 0xffffffff);
    reset(0xfff08083);
    m.x[1] = BF_RAM;
    m.ram[BF_RAM - 1] = 0x80;
    OK(!bf_step(&m, &e));
    OK(m.x[1] == 0xffffff80);
    /* Store/load alias, little endian, signed v unsigned. */
    reset(0x0020a023);
    m.x[1] = 0x200;
    m.x[2] = 0x8081ffff;
    OK(!bf_step(&m, &e));
    OK(m.ram[0x200] == 255 && m.ram[0x203] == 128);
    m.pc = 0x100;
    word(0x00308183);
    OK(!bf_step(&m, &e));
    OK(m.x[3] == 0xffffff80);
    m.pc = 0x100;
    word(0x0030c183);
    OK(!bf_step(&m, &e));
    OK(m.x[3] == 128);
    /* Untrusted random bit patterns may trap or retire exactly once, never mutate x0. */
    uint32_t seed = 0x325eed;
    for (unsigned n = 0; n < 200000; n++) {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        reset(seed);
        m.x[1] = seed;
        m.x[2] = ~seed;
        before = m;
        uint32_t s = bf_step(&m, &e);
        OK(!m.x[0]);
        if (s) {
            OK(m.pc == before.pc && m.retired == 0);
            OK(!memcmp(m.ram, before.ram, BF_RAM));
            OK(!memcmp(m.x, before.x, sizeof(m.x)));
        } else
            OK(m.retired == 1);
    }
    printf("%u precise-trap / decode assertions passed\n", checks);
    return 0;
}
