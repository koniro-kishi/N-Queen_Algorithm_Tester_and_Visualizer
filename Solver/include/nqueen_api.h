#pragma once
#include <string>
#include <vector>

// Board API exposed to every solver. x = row, y = col, 0-based.
bool putQueen(int x, int y);           // true iff no attacking pair after placement
void removeQueen(int x, int y);
std::vector<std::string> viewBoard();  // N strings of N chars: 'Q' or 'x'; a copy
bool checkQueen(int x, int y);

// Implemented by the solver. Return 0 on normal completion.
int solve(int n);
