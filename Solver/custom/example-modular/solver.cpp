#include "nqueen_api.h"
#include "helpers.h"

int solve(int n, int q) {
  prepare(n, q);
  return search(0, 0) ? 0 : 1;
}
