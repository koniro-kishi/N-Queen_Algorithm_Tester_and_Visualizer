#include "helpers.h"

// Same algorithm as Solver/backtracking, split into a helper file to show a multi-file solver.
static int N, Q, placed;
static std::vector<std::string> g;
static std::vector<std::vector<char>> usable;
static std::vector<std::vector<int>> capFrom;
static std::vector<int> suffixCap;

void prepare(int n, int q) {
  N = n;
  Q = q;
  g = viewBoard();
  usable.assign(N, std::vector<char>(N, 0));
  capFrom.assign(N, std::vector<int>(N + 1, 0));
  suffixCap.assign(N + 1, 0);
  placed = 0;
  for (int r = 0; r < N; ++r) {
    for (int c = 0; c < N;) {
      if (g[r][c] == 'W') { ++c; continue; }
      int e = c;
      bool hasQueen = false;
      while (e < N && g[r][e] != 'W') { hasQueen = hasQueen || g[r][e] == 'Q'; ++e; }
      for (int k = c; k < e; ++k) {
        if (g[r][k] == 'Q') ++placed;
        usable[r][k] = !hasQueen && g[r][k] == 'x';
      }
      c = e;
    }
  }
  for (int r = 0; r < N; ++r) {
    for (int from = 0; from <= N; ++from) {
      int cnt = 0;
      for (int c = from; c < N;) {
        if (g[r][c] == 'W') { ++c; continue; }
        int e = c;
        bool any = false;
        while (e < N && g[r][e] != 'W') { any = any || usable[r][e]; ++e; }
        if (any) ++cnt;
        c = e;
      }
      capFrom[r][from] = cnt;
    }
  }
  for (int r = N - 1; r >= 0; --r) suffixCap[r] = suffixCap[r + 1] + capFrom[r][0];
}

static int afterWall(int r, int c) {
  while (c < N && g[r][c] != 'W') ++c;
  return c < N ? c + 1 : N;
}

bool search(int r, int c) {
  if (placed >= Q) return true;
  if (r == N) return false;
  if (placed + capFrom[r][c] + suffixCap[r + 1] < Q) return false;
  for (int k = c; k < N; ++k) {
    if (!usable[r][k]) continue;
    if (putQueen(r, k)) {
      ++placed;
      if (search(r, afterWall(r, k))) return true;
      --placed;
    }
    removeQueen(r, k);
  }
  return search(r + 1, 0);
}
