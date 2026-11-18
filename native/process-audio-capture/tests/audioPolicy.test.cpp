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

  const auto first = reinterpret_cast<HMONITOR>(static_cast<std::uintptr_t>(1));
  const auto second = reinterpret_cast<HMONITOR>(static_cast<std::uintptr_t>(2));
  const auto capture = [&](std::initializer_list<WindowAudioLocation> windows) {
    return SelectMonitorAudioProcesses(windows, first, 99, 10, parents);
  };
  check(capture({{20, first}, {30, second}}) == std::set<DWORD>{20}, "only share the selected monitor");
  check(capture({{20, first}, {30, first}}) == std::set<DWORD>{20, 30}, "include an app when its window moves in");
  check(capture({{20, second}, {30, first}}) == std::set<DWORD>{30}, "remove a process when its window moves out");
  check(capture({{20, first}, {20, second}, {30, first}}) == std::set<DWORD>{30}, "mute the shared process across monitors");
  check(capture({{20, first}, {20, first}}) == std::set<DWORD>{20}, "restore a shared process once its windows are on the selected monitor");
  check(capture({{20, first}, {20, nullptr}}).empty(), "do not include audio from a shared hidden window");
  check(capture({{20, first}, {21, second}}).empty(), "exclude an available root whose loopback includes a window on another monitor");
  check(capture({{20, second}, {21, first}}) == std::set<DWORD>{21}, "a child loopback does not include its off-monitor parent");
  check(capture({{20, first}, {21, first}}) == std::set<DWORD>{20}, "do not duplicate a captured process subtree");
  check(capture({{12, first}, {99, first}}).empty(), "keep playback and the helper out of the mix");

  std::map<DWORD, DWORD> snapshot;
  check(ReadProcessParents(&snapshot), "must read Windows process snapshot");
  check(snapshot.count(GetCurrentProcessId()) == 1, "snapshot must include this test process");
  if (!failures) std::cout << "19 native audio policy checks passed\n";
  return failures ? 1 : 0;
}
