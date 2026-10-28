// Compiled into every solver. Bridges the C++ API to JS host imports.
#include "nqueen_api.h"

extern "C" {
  int  nq_put(int x, int y);
  void nq_remove(int x, int y);
  int  nq_check(int x, int y);
  void nq_view(char* buf, int n);   // host writes n*n bytes ('Q' / 'x') into buf

  int nq_run(int n);                // exported; called by the worker
}

static int g_n = 0;

bool putQueen(int x, int y)    { return nq_put(x, y) != 0; }
void removeQueen(int x, int y) { nq_remove(x, y); }
bool checkQueen(int x, int y)  { return nq_check(x, y) != 0; }

std::vector<std::string> viewBoard() {
  std::string flat(static_cast<size_t>(g_n) * g_n, 'x');
  nq_view(&flat[0], g_n);
  std::vector<std::string> rows;
  rows.reserve(g_n);
  for (int r = 0; r < g_n; ++r) rows.push_back(flat.substr(static_cast<size_t>(r) * g_n, g_n));
  return rows;
}

extern "C" int nq_run(int n) {
  g_n = n;
  return solve(n);
}
