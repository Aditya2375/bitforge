#include "machine.h"
static Machine machine;
static Event event;
void reset(void) {
    bf_reset(&machine);
    event = (Event){0};
}
uint32_t reg(uint32_t i) {
    return i < 32 ? machine.x[i] : 0;
}
uint32_t pc(void) {
    return machine.pc;
}
uint32_t status(void) {
    return machine.status;
}
uint32_t tval(void) {
    return machine.tval;
}
uint32_t retired(void) {
    return machine.retired;
}
uint32_t byte_at(uint32_t a) {
    return a < BF_RAM ? machine.ram[a] : 0;
}
uint32_t poke(uint32_t a, uint32_t v) {
    if (a >= BF_RAM || v > 255)
        return 0;
    machine.ram[a] = (uint8_t)v;
    return 1;
}
uint32_t step(void) {
    return bf_step(&machine, &event);
}
uint32_t field(uint32_t i) {
    switch (i) {
    case 0:
        return event.pc;
    case 1:
        return event.word;
    case 2:
        return event.next_pc;
    case 3:
        return event.rd;
    case 4:
        return event.before;
    case 5:
        return event.after;
    case 6:
        return event.address;
    case 7:
        return event.width;
    case 8:
        return event.loaded;
    case 9:
        return event.stored;
    case 10:
        return event.taken;
    case 11:
        return event.status;
    case 12:
        return event.tval;
    case 13:
        return event.retired;
    case 14:
        return event.memory_before;
    case 15:
        return event.memory_after;
    default:
        return 0;
    }
}
