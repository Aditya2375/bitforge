#include "machine.h"
#include <stdio.h>
#include <stdlib.h>
static Machine m;
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
        m.ram[i] = (uint8_t)(w >> (8 * i));
}
static uint32_t r(unsigned f7, unsigned rs2, unsigned rs1, unsigned f3, unsigned rd) {
    return f7 << 25 | rs2 << 20 | rs1 << 15 | f3 << 12 | rd << 7 | 0x33;
}
int main(void) {
    bf_reset(&m);
    word(0xfff00093);
    OK(!bf_step(&m, &e));
    OK(m.x[1] == 0xffffffff);
    OK(m.pc == 4 && m.retired == 1);
    for (unsigned shift = 0; shift < 32; shift++) {
        bf_reset(&m);
        m.x[1] = 0x80000000;
        m.x[2] = shift;
        word(r(32, 2, 1, 5, 3));
        OK(!bf_step(&m, &e));
        uint32_t v = shift ? 0xffffffffu << (31 - shift) : 0x80000000u;
        OK(m.x[3] == v);
    }
    bf_reset(&m);
    m.x[1] = 0xffffffff;
    word(0x00108093);
    OK(!bf_step(&m, &e));
    OK(m.x[1] == 0);
    bf_reset(&m);
    m.x[1] = 6;
    word(0x000080e7);
    OK(bf_step(&m, &e) == BF_INST_ALIGN);
    OK(m.pc == 0 && m.x[1] == 6 && m.retired == 0 && m.tval == 6);
    bf_reset(&m);
    m.x[1] = 5;
    word(0x000080e7);
    OK(!bf_step(&m, &e));
    OK(m.pc == 4 && m.x[1] == 4);
    bf_reset(&m);
    word(0x00202003);
    OK(bf_step(&m, &e) == BF_LOAD_ALIGN);
    OK(m.x[0] == 0 && m.retired == 0);
    bf_reset(&m);
    word(0x00000073);
    OK(bf_step(&m, &e) == BF_ECALL);
    OK(m.pc == 0 && m.retired == 0);
    OK(bf_step(&m, &e) == BF_ECALL);
    bf_reset(&m);
    word(0x00100073);
    OK(bf_step(&m, &e) == BF_BREAK);
    bf_reset(&m);
    word(0xffffffff);
    OK(bf_step(&m, &e) == BF_ILLEGAL && m.tval == 0xffffffff);
    bf_reset(&m);
    word(0xfff0808f);
    OK(!bf_step(&m, &e)); /* nonzero FENCE reserved fields ignored */
    printf("%u core smoke assertions passed\n", checks);
    return 0;
}
