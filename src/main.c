#include "machine.h"
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static Machine m;
static int digit(int c) {
    if (c >= '0' && c <= '9')
        return c - '0';
    if (c >= 'a' && c <= 'f')
        return c - 'a' + 10;
    if (c >= 'A' && c <= 'F')
        return c - 'A' + 10;
    return -1;
}
/* Return 1 for a bounded text line, 0 at EOF, -1 for binary/oversized input. */
static int read_line(FILE *f, char line[256]) {
    unsigned n = 0;
    int c;
    while ((c = fgetc(f)) != EOF) {
        if (c == 0 || (c != '\n' && n >= 254))
            return -1;
        if (c == '\n') {
            line[n] = 0;
            return 1;
        }
        line[n++] = (char)c;
    }
    line[n] = 0;
    return n ? 1 : 0;
}
int main(int argc, char **argv) {
    if (argc < 2 || argc > 3) {
        fprintf(stderr, "usage: bitforge PROGRAM.hex [1..1000000 steps]\n");
        return 1;
    }
    unsigned long limit = 100000;
    if (argc == 3) {
        char *end;
        errno = 0;
        limit = strtoul(argv[2], &end, 10);
        if (errno || !*argv[2] || *end || limit < 1 || limit > 1000000) {
            fprintf(stderr, "invalid step limit\n");
            return 1;
        }
    }
    FILE *f = fopen(argv[1], "r");
    if (!f) {
        perror("program");
        return 1;
    }
    bf_reset(&m);
    char line[256];
    unsigned address = 0, lineno = 0;
    int line_status;
    while ((line_status = read_line(f, line)) > 0) {
        lineno++;
        char *p = line;
        while (*p == ' ' || *p == '\t' || *p == '\r')
            p++;
        if (*p == '#' || *p == '\n' || !*p)
            continue;
        uint32_t w = 0;
        unsigned n = 0;
        while (digit((unsigned char)*p) >= 0) {
            if (n == 8)
                break;
            w = (w << 4) | (unsigned)digit((unsigned char)*p++);
            n++;
        }
        while (*p == ' ' || *p == '\t' || *p == '\r')
            p++;
        if (n != 8 || (*p && *p != '\n' && *p != '#') || address > BF_RAM - 4) {
            fprintf(stderr, "invalid word or program too large at line %u\n", lineno);
            fclose(f);
            return 1;
        }
        for (unsigned i = 0; i < 4; i++)
            m.ram[address++] = (uint8_t)(w >> (8 * i));
    }
    if (line_status < 0 || ferror(f) || !address) {
        fprintf(stderr, "binary, oversized, unreadable or empty program\n");
        fclose(f);
        return 1;
    }
    fclose(f);
    Event e;
    for (unsigned long i = 0; i < limit && !m.status; i++)
        bf_step(&m, &e);
    printf("{\"pc\":%u,\"status\":%u,\"tval\":%u,\"retired\":%u,\"registers\":[", m.pc, m.status,
           m.tval, m.retired);
    for (unsigned i = 0; i < 32; i++)
        printf("%s%u", i ? "," : "", m.x[i]);
    printf("],\"memory_0x400\":[");
    for (unsigned i = 0; i < 64; i++)
        printf("%s%u", i ? "," : "", m.ram[0x400 + i]);
    puts("]}");
    return m.status == BF_BREAK ? 0 : m.status ? 2 : 3;
}
