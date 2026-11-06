// Runs every TEST in the files linked with it.
#include <vector>

#include "check.h"

int main() {
  std::vector<check::Test *> tests;
  for (check::Test *t = check::Test::head(); t; t = t->next) tests.insert(tests.begin(), t);
  for (check::Test *t : tests) {
    int before = check::failures();
    t->fn();
    printf("%s %s\n", check::failures() == before ? "ok  " : "FAIL", t->name);
  }
  printf("%d checks, %d failed\n", check::checks(), check::failures());
  return check::failures() ? 1 : 0;
}
