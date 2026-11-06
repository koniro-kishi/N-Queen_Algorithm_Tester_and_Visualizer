#include "nqueen_api.h"

// Loop tanpa yield dan tanpa memanggil API. volatile mencegah optimizer membuangnya.
int solve(int n, int q) {
  (void)n;
  (void)q;
  volatile unsigned long long x = 0;
  for (;;) {
    x = x + 1;
  }
}
