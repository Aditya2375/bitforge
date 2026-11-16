#ifndef BITFORGE_MACHINE_H
#define BITFORGE_MACHINE_H
#include <stdint.h>
#define BF_RAM 65536u
#define BF_RUNNING 0u
#define BF_INST_ALIGN 1u
#define BF_INST_ACCESS 2u
#define BF_ILLEGAL 3u
#define BF_LOAD_ALIGN 4u
#define BF_LOAD_ACCESS 5u
#define BF_STORE_ALIGN 6u
#define BF_STORE_ACCESS 7u
#define BF_ECALL 8u
#define BF_BREAK 9u
/* An instruction-level, single-hart RV32I execution environment. No privilege/CSR. */
typedef struct {
    uint32_t x[32], pc, status, tval, retired;
    uint8_t ram[BF_RAM];
} Machine;
typedef struct {
    uint32_t pc, word, next_pc, rd, before, after, address, width, loaded, stored, taken, status,
        tval, retired, memory_before, memory_after;
} Event;
void bf_reset(Machine *m);
uint32_t bf_step(Machine *m, Event *e);
#endif
