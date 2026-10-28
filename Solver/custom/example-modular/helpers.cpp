#include "helpers.h"

std::vector<bool> fixedRows;

std::vector<bool> scanFixedRows(int n) {
  auto b = viewBoard();
  std::vector<bool> f(n, false);
  for (int r = 0; r < n; ++r)
    for (int c = 0; c < n; ++c)
      if (b[r][c] == 'Q') f[r] = true;
  return f;
}

bool search(int n, int r) {
  if (r == n) return true;
  if (fixedRows[r]) return search(n, r + 1);
  for (int c = 0; c < n; ++c) {
    if (putQueen(r, c) && search(n, r + 1)) return true;
    removeQueen(r, c);
  }
  return false;
}
