#include "machine.h"
static uint32_t sx(uint32_t v, unsigned bits) {
    uint32_t sign = 1u << (bits - 1);
    return (v ^ sign) - sign;
}
static int less(uint32_t a, uint32_t b) {
    return (a ^ 0x80000000u) < (b ^ 0x80000000u);
}
static uint32_t asr(uint32_t a, unsigned shift) {
    if (!shift)
        return a;
    return (a >> shift) | ((a & 0x80000000u) ? (~0u << (32 - shift)) : 0u);
}
static void zero(void *p, uint32_t n) {
    uint8_t *s = p;
    for (uint32_t i = 0; i < n; i++)
        s[i] = 0;
}
void bf_reset(Machine *m) {
    zero(m, sizeof(*m));
}
static uint32_t trap(Machine *m, Event *e, uint32_t status, uint32_t value) {
    m->status = status;
    m->tval = value;
    e->status = status;
    e->tval = value;
    e->next_pc = m->pc;
    e->retired = m->retired;
    return status;
}
uint32_t bf_step(Machine *m, Event *e) {
    zero(e, sizeof(*e));
    e->pc = m->pc;
    e->next_pc = m->pc;
    e->rd = 32;
    e->retired = m->retired;
    if (m->status) {
        e->status = m->status;
        e->tval = m->tval;
        return m->status;
    }
    if (m->pc & 3u)
        return trap(m, e, BF_INST_ALIGN, m->pc);
    if (m->pc > BF_RAM - 4)
        return trap(m, e, BF_INST_ACCESS, m->pc);
    uint32_t pc = m->pc, w = 0;
    for (unsigned i = 0; i < 4; i++)
        w |= (uint32_t)m->ram[pc + i] << (8 * i);
    e->word = w;
    unsigned op = w & 127, rd = (w >> 7) & 31, f3 = (w >> 12) & 7, r1 = (w >> 15) & 31,
             r2 = (w >> 20) & 31, f7 = w >> 25;
    uint32_t a = r1 ? m->x[r1] : 0, b = r2 ? m->x[r2] : 0, imm = sx(w >> 20, 12), value = 0,
             next = pc + 4, addr = 0;
    unsigned width = 0;
    int write = 0, store = 0;
    switch (op) {
    case 0x37:
        value = w & 0xfffff000u;
        write = 1;
        break;
    case 0x17:
        value = pc + (w & 0xfffff000u);
        write = 1;
        break;
    case 0x6f:
        imm = sx(((w >> 31) << 20) | (((w >> 12) & 255) << 12) | (((w >> 20) & 1) << 11) |
                     (((w >> 21) & 1023) << 1),
                 21);
        next = pc + imm;
        if (next & 3)
            return trap(m, e, BF_INST_ALIGN, next);
        value = pc + 4;
        write = 1;
        e->taken = 1;
        break;
    case 0x67:
        if (f3)
            return trap(m, e, BF_ILLEGAL, w);
        next = (a + imm) & ~1u;
        if (next & 3)
            return trap(m, e, BF_INST_ALIGN, next);
        value = pc + 4;
        write = 1;
        e->taken = 1;
        break;
    case 0x63: {
        int take;
        switch (f3) {
        case 0:
            take = a == b;
            break;
        case 1:
            take = a != b;
            break;
        case 4:
            take = less(a, b);
            break;
        case 5:
            take = !less(a, b);
            break;
        case 6:
            take = a < b;
            break;
        case 7:
            take = a >= b;
            break;
        default:
            return trap(m, e, BF_ILLEGAL, w);
        }
        e->taken = (uint32_t)take;
        if (take) {
            imm = sx(((w >> 31) << 12) | (((w >> 7) & 1) << 11) | (((w >> 25) & 63) << 5) |
                         (((w >> 8) & 15) << 1),
                     13);
            next = pc + imm;
            if (next & 3)
                return trap(m, e, BF_INST_ALIGN, next);
        }
        break;
    }
    case 0x03:
        if (f3 == 0 || f3 == 4)
            width = 1;
        else if (f3 == 1 || f3 == 5)
            width = 2;
        else if (f3 == 2)
            width = 4;
        else
            return trap(m, e, BF_ILLEGAL, w);
        addr = a + imm;
        e->address = addr;
        e->width = width;
        if (addr & (width - 1))
            return trap(m, e, BF_LOAD_ALIGN, addr);
        if (addr > BF_RAM - width)
            return trap(m, e, BF_LOAD_ACCESS, addr);
        for (unsigned i = 0; i < width; i++)
            value |= (uint32_t)m->ram[addr + i] << (8 * i);
        if (f3 < 2)
            value = sx(value, width * 8);
        write = 1;
        e->loaded = 1;
        break;
    case 0x23:
        if (f3 > 2)
            return trap(m, e, BF_ILLEGAL, w);
        width = 1u << f3;
        imm = sx(((w >> 25) << 5) | ((w >> 7) & 31), 12);
        addr = a + imm;
        e->address = addr;
        e->width = width;
        if (addr & (width - 1))
            return trap(m, e, BF_STORE_ALIGN, addr);
        if (addr > BF_RAM - width)
            return trap(m, e, BF_STORE_ACCESS, addr);
        store = 1;
        break;
    case 0x13:
        write = 1;
        switch (f3) {
        case 0:
            value = a + imm;
            break;
        case 2:
            value = (uint32_t)less(a, imm);
            break;
        case 3:
            value = (uint32_t)(a < imm);
            break;
        case 4:
            value = a ^ imm;
            break;
        case 6:
            value = a | imm;
            break;
        case 7:
            value = a & imm;
            break;
        case 1:
            if (f7)
                return trap(m, e, BF_ILLEGAL, w);
            value = a << r2;
            break;
        case 5:
            if (f7 != 0 && f7 != 32)
                return trap(m, e, BF_ILLEGAL, w);
            value = f7 == 32 ? asr(a, r2) : a >> r2;
            break;
        }
        break;
    case 0x33:
        write = 1;
        if (f7 != 0 && !(f7 == 32 && (f3 == 0 || f3 == 5)))
            return trap(m, e, BF_ILLEGAL, w);
        switch (f3) {
        case 0:
            value = f7 ? a - b : a + b;
            break;
        case 1:
            value = a << (b & 31);
            break;
        case 2:
            value = (uint32_t)less(a, b);
            break;
        case 3:
            value = (uint32_t)(a < b);
            break;
        case 4:
            value = a ^ b;
            break;
        case 5:
            value = f7 ? asr(a, b & 31) : a >> (b & 31);
            break;
        case 6:
            value = a | b;
            break;
        case 7:
            value = a & b;
            break;
        }
        break;
    case 0x0f:
        if (f3 != 0)
            return trap(m, e, BF_ILLEGAL, w);
        break; /* Single hart/no devices: FENCE, reserved fm/rs1/rd ignored. */
    case 0x73:
        if (w == 0x00000073u)
            return trap(m, e, BF_ECALL, 0);
        if (w == 0x00100073u)
            return trap(m, e, BF_BREAK, 0);
        return trap(m, e, BF_ILLEGAL, w);
    default:
        return trap(m, e, BF_ILLEGAL, w);
    }
    /* No architected state changes until decode, alignment and access checks pass. */
    if (store) {
        for (unsigned i = 0; i < width; i++) {
            e->memory_before |= (uint32_t)m->ram[addr + i] << (8 * i);
            m->ram[addr + i] = (uint8_t)(b >> (8 * i));
            e->memory_after |= (uint32_t)m->ram[addr + i] << (8 * i);
        }
        e->stored = 1;
    }
    if (write) {
        e->rd = rd;
        e->before = rd ? m->x[rd] : 0;
        e->after = rd ? value : 0;
        if (rd)
            m->x[rd] = value;
    }
    m->x[0] = 0;
    m->pc = next;
    m->retired++;
    e->next_pc = next;
    e->retired = m->retired;
    return BF_RUNNING;
}
