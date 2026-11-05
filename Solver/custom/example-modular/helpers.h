#pragma once
#include "nqueen_api.h"

// Reads the initial board and builds the pruning tables for target q.
void prepare(int n, int q);
// Tries to reach q queens starting at row r, column c.
bool search(int r, int c);
