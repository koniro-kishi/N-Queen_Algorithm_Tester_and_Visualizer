#pragma once
#include <string>
#include <vector>

// Board API exposed to every solver. x = row, y = col, 0-based.
// Cells in viewBoard(): 'Q' = queen, 'x' = empty, 'W' = wall (Walled N-Queen). A wall holds no queen
// (putQueen on it is an Execution Error) and cuts every line through it: two queens attack each other
// only if no wall lies strictly between them on their shared row, column or diagonal.
bool putQueen(int x, int y);           // true iff no attacking pair after placement
void removeQueen(int x, int y);
std::vector<std::string> viewBoard();  // N strings of N chars: 'Q', 'x' or 'W'; a copy
bool checkQueen(int x, int y);

// Implemented by the solver. Return 0 on normal completion.
// n = board size, q = target: the final board must hold at least q queens with no attacking pair.
// Classic N-Queen (no walls) always passes q = n. Preplaced queens are already on the board and count toward q.
int solve(int n, int q);
