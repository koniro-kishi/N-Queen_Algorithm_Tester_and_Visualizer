#include "nqueen_api.h"

static int N;
static std::vector<bool> fixedRow;

static bool place(int r) {
  if (r == N) return true;
  if (fixedRow[r]) return place(r + 1);
  for (int c = 0; c < N; ++c) {
    if (putQueen(r, c) && place(r + 1)) return true;
    removeQueen(r, c);  // putQueen keeps the queen even on conflict
  }
  return false;
}

int solve(int n) {
  N = n;
  auto b = viewBoard();
  fixedRow.assign(n, false);
  for (int r = 0; r < n; ++r)
    for (int c = 0; c < n; ++c)
      if (b[r][c] == 'Q') fixedRow[r] = true;
  return place(0) ? 0 : 1;
}
