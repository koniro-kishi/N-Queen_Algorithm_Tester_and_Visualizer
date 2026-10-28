#pragma once
#include "nqueen_api.h"
extern std::vector<bool> fixedRows;
std::vector<bool> scanFixedRows(int n);
bool search(int n, int r);
