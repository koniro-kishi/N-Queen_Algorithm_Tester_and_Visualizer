#include "nqueen_api.h"
#include "helpers.h"

int solve(int n) {
  fixedRows = scanFixedRows(n);
  return search(n, 0) ? 0 : 1;
}
