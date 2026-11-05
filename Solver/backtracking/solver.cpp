#include "nqueen_api.h"

// Reference solver for Classic and Walled N-Queen. Row by row, left to right; a row takes more than one queen
// only when a wall separates them. Without walls and with q = n it makes exactly the same putQueen/removeQueen
// calls as the original one-queen-per-row backtracking, so existing benchmarks stay comparable.

static int N, Q, placed;
static std::vector<std::string> g;             // initial board: 'Q' preplaced, 'W' wall, 'x' empty
static std::vector<std::vector<char>> usable;  // cell may be tried: empty, and its row segment holds no preplaced queen
static std::vector<std::vector<int>> capFrom;  // capFrom[r][c]: row segments with a usable cell at col >= c
static std::vector<int> suffixCap;             // suffixCap[r]: sum of capFrom[row][0] over rows >= r

static void prepare() {
  g = viewBoard();
  usable.assign(N, std::vector<char>(N, 0));
  capFrom.assign(N, std::vector<int>(N + 1, 0));
  suffixCap.assign(N + 1, 0);
  placed = 0;
  for (int r = 0; r < N; ++r) {
    for (int c = 0; c < N;) {
      if (g[r][c] == 'W') { ++c; continue; }
      int e = c;                               // [c, e) is one wall-free run of row r
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

// Column just after the next wall at or after c in row r (N if none). Cells before it share a row segment with
// the queen just placed, so they are attacked and not worth a call.
static int afterWall(int r, int c) {
  while (c < N && g[r][c] != 'W') ++c;
  return c < N ? c + 1 : N;
}

static bool search(int r, int c) {
  if (placed >= Q) return true;
  if (r == N) return false;
  if (placed + capFrom[r][c] + suffixCap[r + 1] < Q) return false;  // Q is out of reach
  for (int k = c; k < N; ++k) {
    if (!usable[r][k]) continue;
    if (putQueen(r, k)) {
      ++placed;
      if (search(r, afterWall(r, k))) return true;
      --placed;
    }
    removeQueen(r, k);                         // putQueen keeps the queen even on conflict
  }
  return search(r + 1, 0);                     // no further queen in this row
}

int solve(int n, int q) {
  N = n;
  Q = q;
  prepare();
  return search(0, 0) ? 0 : 1;
}
