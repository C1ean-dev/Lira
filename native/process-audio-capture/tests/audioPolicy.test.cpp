#define wmain captureMain
#include "../main.cpp"
#undef wmain

int main() {
  // 10 is Lira, 11/12 are its renderer/audio processes. A browser and game
  // are unrelated processes even when started by the same desktop shell.
  const std::map<DWORD, DWORD> parents{{10, 1}, {11, 10}, {12, 11}, {20, 1}, {21, 20}, {30, 1}};
  int failures = 0;
  const auto check = [&](bool passed, const char* message) {
    if (!passed) { std::cerr << message << '\n'; ++failures; }
  };
  check(ShouldExcludeProcessAudio(10, 10, parents), "must exclude Lira itself");
  check(ShouldExcludeProcessAudio(12, 10, parents), "must exclude audio/render descendants");
  check(ShouldExcludeProcessAudio(1, 10, parents), "must exclude a parent whose loopback includes Lira");
  check(!ShouldExcludeProcessAudio(20, 10, parents), "must preserve another app");
  check(!ShouldExcludeProcessAudio(21, 10, parents), "must preserve another app's audio process");
  check(!ShouldExcludeProcessAudio(30, 10, parents), "must preserve the game");
  const std::map<DWORD, DWORD> malformed{{20, 21}, {21, 20}};
  check(!ShouldExcludeProcessAudio(20, 10, malformed), "must handle process ancestry cycles");
  std::map<DWORD, DWORD> snapshot;
  check(ReadProcessParents(&snapshot), "must read Windows process snapshot");
  check(snapshot.count(GetCurrentProcessId()) == 1, "snapshot must include this test process");
  if (!failures) std::cout << "9 native audio exclusion checks passed\n";
  return failures ? 1 : 0;
}
