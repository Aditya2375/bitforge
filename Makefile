CC = cc
CFLAGS = -std=c11 -O2 -Wall -Wextra -Werror -Isrc
EXTRA =
all: build/bitforge build/core-test build/trap-test build/libbitforge.so
build:
	mkdir -p build
build/bitforge: src/machine.c src/machine.h src/main.c | build
	$(CC) $(CFLAGS) $(EXTRA) src/machine.c src/main.c -o $@
build/core-test: src/machine.c src/machine.h tests/core.c | build
	$(CC) $(CFLAGS) $(EXTRA) src/machine.c tests/core.c -o $@
build/trap-test: src/machine.c src/machine.h tests/traps.c | build
	$(CC) $(CFLAGS) $(EXTRA) src/machine.c tests/traps.c -o $@
build/libbitforge.so: src/machine.c src/machine.h | build
	$(CC) $(CFLAGS) -shared -fPIC src/machine.c -o $@
test: all
	./build/core-test
	./build/trap-test
differential: all
	python3 tests/differential.py
sanitize:
	$(MAKE) clean
	$(MAKE) EXTRA='-fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer' test
clean:
	rm -rf build
.PHONY: all test differential sanitize clean
