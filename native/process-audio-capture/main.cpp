// Windows WASAPI process-loopback helper for the desktop client.
// Supports both single-window capture and dynamic whole-screen monitor capture.
// stdout is raw PCM only: signed 16-bit little-endian, stereo, 48 kHz.

#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <propvarutil.h>
#include <roapi.h>
#include <dwmapi.h>
#include <timeapi.h>

#pragma comment(lib, "winmm.lib")

#include <atomic>
#include <chrono>
#include <cwchar>
#include <iostream>
#include <map>
#include <memory>
#include <new>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace {

constexpr WORD kChannels = 2;
constexpr DWORD kSampleRate = 48000;
constexpr WORD kBitsPerSample = 16;
constexpr DWORD kBytesPerFrame = kChannels * (kBitsPerSample / 8); // 4 bytes

class ActivationHandler final : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
 public:
  ActivationHandler() : completed_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}
  ~ActivationHandler() {
    if (client_) client_->Release();
    if (completed_) CloseHandle(completed_);
  }

  HRESULT WaitForClient(IAudioClient** client) {
    if (!completed_) return HRESULT_FROM_WIN32(GetLastError());
    const DWORD wait = WaitForSingleObject(completed_, 5000);
    if (wait != WAIT_OBJECT_0) return HRESULT_FROM_WIN32(wait == WAIT_TIMEOUT ? ERROR_TIMEOUT : GetLastError());
    if (FAILED(result_)) return result_;
    if (!client_) return E_NOINTERFACE;
    client_->AddRef();
    *client = client_;
    return S_OK;
  }

  STDMETHODIMP QueryInterface(REFIID iid, void** object) override {
    if (!object) return E_POINTER;
    if (iid == __uuidof(IAgileObject)) {
      *object = static_cast<IAgileObject*>(this);
      AddRef();
      return S_OK;
    }
    if (iid == IID_IUnknown || iid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *object = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
      AddRef();
      return S_OK;
    }
    *object = nullptr;
    return E_NOINTERFACE;
  }

  STDMETHODIMP_(ULONG) AddRef() override { return ++references_; }
  STDMETHODIMP_(ULONG) Release() override {
    const ULONG references = --references_;
    if (references == 0) delete this;
    return references;
  }

  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
    IUnknown* unknown = nullptr;
    HRESULT activationResult = E_FAIL;
    result_ = operation->GetActivateResult(&activationResult, &unknown);
    if (SUCCEEDED(result_)) result_ = activationResult;
    if (SUCCEEDED(result_) && unknown) result_ = unknown->QueryInterface(IID_PPV_ARGS(&client_));
    if (unknown) unknown->Release();
    SetEvent(completed_);
    return S_OK;
  }

 private:
  std::atomic<ULONG> references_{1};
  HANDLE completed_ = nullptr;
  HRESULT result_ = E_UNEXPECTED;
  IAudioClient* client_ = nullptr;
};

bool ParseWindowHandle(const wchar_t* sourceId, HWND* window) {
  constexpr wchar_t prefix[] = L"window:";
  if (!sourceId || wcsncmp(sourceId, prefix, _countof(prefix) - 1) != 0) return false;
  const wchar_t* value = sourceId + _countof(prefix) - 1;
  wchar_t* end = nullptr;
  const unsigned long long handleValue = wcstoull(value, &end, 10);
  if (end == value || !end || *end != L':') return false;
  *window = reinterpret_cast<HWND>(static_cast<uintptr_t>(handleValue));
  return IsWindow(*window) != FALSE;
}

void PrintError(const wchar_t* message, HRESULT hr);

HRESULT ActivateProcessLoopback(DWORD processId, IAudioClient** audioClient) {
  AUDIOCLIENT_ACTIVATION_PARAMS parameters = {};
  parameters.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  parameters.ProcessLoopbackParams.TargetProcessId = processId;
  parameters.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activation = {};
  activation.vt = VT_BLOB;
  activation.blob.cbSize = sizeof(parameters);
  activation.blob.pBlobData = reinterpret_cast<BYTE*>(&parameters);

  auto* handler = new (std::nothrow) ActivationHandler();
  if (!handler) return E_OUTOFMEMORY;
  IActivateAudioInterfaceAsyncOperation* operation = nullptr;
  HRESULT hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &activation, handler, &operation);
  if (SUCCEEDED(hr)) hr = handler->WaitForClient(audioClient);
  if (FAILED(hr)) PrintError(L"Process-loopback activation failed", hr);
  if (operation) operation->Release();
  handler->Release();
  return hr;
}

bool WriteAll(HANDLE output, const BYTE* data, DWORD size) {
  while (size > 0) {
    DWORD written = 0;
    if (!WriteFile(output, data, size, &written, nullptr) || written == 0) return false;
    data += written;
    size -= written;
  }
  return true;
}

bool WriteSilence(HANDLE output, DWORD bytes) {
  constexpr DWORD kChunk = 4096;
  BYTE zeros[kChunk] = {};
  while (bytes > 0) {
    const DWORD count = bytes > kChunk ? kChunk : bytes;
    if (!WriteAll(output, zeros, count)) return false;
    bytes -= count;
  }
  return true;
}

void PrintError(const wchar_t* message, HRESULT hr) {
  std::wcerr << L"[process-audio-capture] " << message << L" (0x" << std::hex << hr << L")\n";
}

struct ProcessSession {
  DWORD pid{0};
  IAudioClient* audioClient{nullptr};
  IAudioCaptureClient* captureClient{nullptr};
  HANDLE sampleEvent{nullptr};
  std::vector<int16_t> buffer;

  void Dispose() {
    if (audioClient) {
      audioClient->Stop();
    }
    if (captureClient) {
      captureClient->Release();
      captureClient = nullptr;
    }
    if (sampleEvent) {
      CloseHandle(sampleEvent);
      sampleEvent = nullptr;
    }
    if (audioClient) {
      audioClient->Release();
      audioClient = nullptr;
    }
    buffer.clear();
  }
};

std::unique_ptr<ProcessSession> CreateProcessSession(DWORD pid, const WAVEFORMATEX& format, HRESULT* failure = nullptr) {
  if (failure) *failure = S_OK;
  IAudioClient* client = nullptr;
  HRESULT hr = ActivateProcessLoopback(pid, &client);
  if (FAILED(hr) || !client) {
    if (failure) *failure = FAILED(hr) ? hr : E_NOINTERFACE;
    return nullptr;
  }

  HANDLE sampleEvent = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!sampleEvent) {
    if (failure) *failure = HRESULT_FROM_WIN32(GetLastError());
    client->Release();
    return nullptr;
  }

  hr = client->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
      0, 0, &format, nullptr);
  if (FAILED(hr)) {
    if (failure) *failure = hr;
    CloseHandle(sampleEvent);
    client->Release();
    return nullptr;
  }

  hr = client->SetEventHandle(sampleEvent);
  if (FAILED(hr)) {
    if (failure) *failure = hr;
    CloseHandle(sampleEvent);
    client->Release();
    return nullptr;
  }

  IAudioCaptureClient* capture = nullptr;
  hr = client->GetService(IID_PPV_ARGS(&capture));
  if (FAILED(hr) || !capture) {
    if (failure) *failure = FAILED(hr) ? hr : E_NOINTERFACE;
    CloseHandle(sampleEvent);
    client->Release();
    return nullptr;
  }

  hr = client->Start();
  if (FAILED(hr)) {
    if (failure) *failure = hr;
    capture->Release();
    CloseHandle(sampleEvent);
    client->Release();
    return nullptr;
  }

  auto session = std::make_unique<ProcessSession>();
  session->pid = pid;
  session->audioClient = client;
  session->captureClient = capture;
  session->sampleEvent = sampleEvent;
  return session;
}

struct WindowScanContext {
  HMONITOR targetMonitor;
  DWORD selfPid;
  RECT targetBounds;
  std::set<DWORD> pidsOnScreen;
};

std::wstring GetProcessDisplayName(DWORD processId) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
  if (!process) return L"<unavailable>";

  wchar_t path[32768] = {};
  DWORD pathLength = static_cast<DWORD>(_countof(path));
  const BOOL resolved = QueryFullProcessImageNameW(process, 0, path, &pathLength);
  CloseHandle(process);
  if (!resolved || pathLength == 0) return L"<unavailable>";

  const wchar_t* name = wcsrchr(path, L'\\');
  return name ? std::wstring(name + 1) : std::wstring(path, pathLength);
}

BOOL CALLBACK ScanWindowsProc(HWND hwnd, LPARAM lParam) {
  auto* ctx = reinterpret_cast<WindowScanContext*>(lParam);
  if (!IsWindow(hwnd) || !IsWindowVisible(hwnd) || IsIconic(hwnd)) return TRUE;

  int cloaked = 0;
  DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked));
  if (cloaked) return TRUE;

  RECT rc = {};
  if (!GetWindowRect(hwnd, &rc) || (rc.right - rc.left <= 20) || (rc.bottom - rc.top <= 20)) return TRUE;

  // MonitorFromWindow(..., MONITOR_DEFAULTTONEAREST) assigns a window that
  // spans two displays to whichever display contains its center. That drops
  // audio from a browser/game window that overlaps the selected display but
  // has its center on another one. Use the actual monitor rectangle instead.
  const RECT& monitor = ctx->targetBounds;
  const bool intersectsMonitor = rc.left < monitor.right && rc.right > monitor.left &&
                                 rc.top < monitor.bottom && rc.bottom > monitor.top;
  if (intersectsMonitor) {
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid != 0 && pid != ctx->selfPid) {
      ctx->pidsOnScreen.insert(pid);
    }
  }
  return TRUE;
}

std::set<DWORD> ScanProcessesOnMonitor(HMONITOR targetMonitor, DWORD selfPid) {
  MONITORINFO monitorInfo = {sizeof(monitorInfo)};
  if (!targetMonitor || !GetMonitorInfoW(targetMonitor, &monitorInfo)) {
    std::wcerr << L"[process-audio-capture] Could not resolve selected monitor bounds.\n";
    return {};
  }

  WindowScanContext ctx{targetMonitor, selfPid, monitorInfo.rcMonitor, {}};
  HDESK desk = OpenInputDesktop(0, FALSE, GENERIC_ALL);
  if (desk) {
    EnumDesktopWindows(desk, ScanWindowsProc, reinterpret_cast<LPARAM>(&ctx));
    CloseDesktop(desk);
  } else {
    EnumWindows(ScanWindowsProc, reinterpret_cast<LPARAM>(&ctx));
  }
  return ctx.pidsOnScreen;
}

int RunWindowCapture(HWND targetWindow) {
  DWORD processId = 0;
  if (GetWindowThreadProcessId(targetWindow, &processId) == 0 || processId == 0) {
    std::wcerr << L"[process-audio-capture] Could not resolve the selected window process.\n";
    return 4;
  }

  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = kChannels;
  format.nSamplesPerSec = kSampleRate;
  format.wBitsPerSample = kBitsPerSample;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

  HRESULT sessionError = S_OK;
  auto session = CreateProcessSession(processId, format, &sessionError);
  if (!session) {
    PrintError((std::wstring(L"Could not initialize loopback for process ") + std::to_wstring(processId)).c_str(), sessionError);
    return 6;
  }

  std::wcerr << L"[process-audio-capture] READY\n";
  std::wcerr.flush();

  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  bool keepCapturing = output && output != INVALID_HANDLE_VALUE;
  uint64_t bytesWritten = 0;
  uint64_t nonSilentBytes = 0;
  uint64_t packetCount = 0;
  auto lastStats = std::chrono::steady_clock::now();
  while (keepCapturing) {
    const DWORD wait = WaitForSingleObject(session->sampleEvent, 1000);
    if (wait != WAIT_OBJECT_0 && wait != WAIT_TIMEOUT) break;

    UINT32 nextPacketFrames = 0;
    while (keepCapturing && SUCCEEDED(session->captureClient->GetNextPacketSize(&nextPacketFrames)) && nextPacketFrames > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      HRESULT hr = session->captureClient->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) {
        PrintError(L"Could not read process audio", hr);
        keepCapturing = false;
        break;
      }

      const DWORD bytes = frames * format.nBlockAlign;
      const bool silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
      keepCapturing = silent ? WriteSilence(output, bytes) : WriteAll(output, data, bytes);
      if (keepCapturing) {
        bytesWritten += bytes;
        if (!silent) nonSilentBytes += bytes;
        packetCount++;
      }
      session->captureClient->ReleaseBuffer(frames);
    }

    if (std::chrono::steady_clock::now() - lastStats >= std::chrono::seconds(2)) {
      std::wcerr << L"[process-audio-capture] STATS mode=window pid=" << processId
                 << L" bytes=" << bytesWritten << L" nonSilentBytes=" << nonSilentBytes
                 << L" packets=" << packetCount << L"\n";
      std::wcerr.flush();
      lastStats = std::chrono::steady_clock::now();
    }
  }

  session->Dispose();
  return 0;
}

int RunScreenCapture(int left, int top, int width, int height) {
  POINT centerPt = { left + width / 2, top + height / 2 };
  HMONITOR targetMonitor = MonitorFromPoint(centerPt, MONITOR_DEFAULTTONEAREST);
  if (!targetMonitor) {
    std::wcerr << L"[process-audio-capture] Target monitor could not be resolved from coordinates.\n";
    return 3;
  }

  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = kChannels;
  format.nSamplesPerSec = kSampleRate;
  format.wBitsPerSample = kBitsPerSample;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

  const DWORD selfPid = GetCurrentProcessId();
  std::map<DWORD, std::unique_ptr<ProcessSession>> sessions;
  std::map<DWORD, HRESULT> failedSessions;
  std::set<DWORD> lastDesiredPids;

  std::wcerr << L"[process-audio-capture] READY\n";
  MONITORINFO monitorInfo = {sizeof(monitorInfo)};
  if (GetMonitorInfoW(targetMonitor, &monitorInfo)) {
    std::wcerr << L"[process-audio-capture] MONITOR_TARGET left=" << monitorInfo.rcMonitor.left
               << L" top=" << monitorInfo.rcMonitor.top
               << L" right=" << monitorInfo.rcMonitor.right
               << L" bottom=" << monitorInfo.rcMonitor.bottom << L"\n";
  }
  std::wcerr.flush();

  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  bool keepCapturing = output && output != INVALID_HANDLE_VALUE;

  auto lastScanTime = std::chrono::steady_clock::now() - std::chrono::milliseconds(500);

  // Buffer for mixing multiple streams (480 frames = 10ms of audio)
  constexpr UINT32 kMixFrames = 480;
  std::vector<int32_t> mixBufferLeft(kMixFrames, 0);
  std::vector<int32_t> mixBufferRight(kMixFrames, 0);
  std::vector<int16_t> outputPcm(kMixFrames * kChannels, 0);
  uint64_t bytesWritten = 0;
  uint64_t nonSilentSamples = 0;
  uint64_t scanCount = 0;
  auto lastStats = std::chrono::steady_clock::now();
  // Clock-driven output pacing (see the mixing loop below).
  constexpr uint64_t kMaxCatchUpFrames = kSampleRate / 10;  // 100 ms
  const auto pacingStart = std::chrono::steady_clock::now();
  uint64_t framesEmitted = 0;
  timeBeginPeriod(1);

  while (keepCapturing) {
    auto now = std::chrono::steady_clock::now();
    if (now - lastScanTime >= std::chrono::milliseconds(300)) {
      lastScanTime = now;
      std::set<DWORD> desiredPids = ScanProcessesOnMonitor(targetMonitor, selfPid);
      scanCount++;
      if (desiredPids != lastDesiredPids) {
        std::wcerr << L"[process-audio-capture] MONITOR_SCAN count=" << scanCount
                   << L" desiredProcesses=" << desiredPids.size();
        for (const DWORD pid : desiredPids) {
          std::wcerr << L" [pid=" << pid << L" name=" << GetProcessDisplayName(pid) << L"]";
        }
        std::wcerr << L"\n";
        lastDesiredPids = desiredPids;
      }

      // Stop and remove sessions whose windows left this monitor
      for (auto it = sessions.begin(); it != sessions.end();) {
        if (desiredPids.find(it->first) == desiredPids.end()) {
          it->second->Dispose();
          failedSessions.erase(it->first);
          it = sessions.erase(it);
        } else {
          ++it;
        }
      }

      // Start sessions for newly arrived processes on this monitor
      for (DWORD pid : desiredPids) {
        if (sessions.find(pid) == sessions.end()) {
          HRESULT sessionError = S_OK;
          auto session = CreateProcessSession(pid, format, &sessionError);
          if (session) {
            sessions[pid] = std::move(session);
            failedSessions.erase(pid);
            std::wcerr << L"[process-audio-capture] SESSION_ADD pid=" << pid
                       << L" name=" << GetProcessDisplayName(pid) << L"\n";
          } else if (failedSessions.find(pid) == failedSessions.end() || failedSessions[pid] != sessionError) {
            failedSessions[pid] = sessionError;
            std::wcerr << L"[process-audio-capture] SESSION_SKIP pid=" << pid
                       << L" name=" << GetProcessDisplayName(pid)
                       << L" hr=0x" << std::hex << sessionError << std::dec << L"\n";
          }
        }
      }
    }

    // Drain packets from all active sessions into their pending sample buffers
    for (auto& pair : sessions) {
      auto& s = pair.second;
      UINT32 nextPacketFrames = 0;
      while (SUCCEEDED(s->captureClient->GetNextPacketSize(&nextPacketFrames)) && nextPacketFrames > 0) {
        BYTE* data = nullptr;
        UINT32 frames = 0;
        DWORD flags = 0;
        HRESULT hr = s->captureClient->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
        if (FAILED(hr)) break;

        const int16_t* pcmIn = reinterpret_cast<const int16_t*>(data);
        const size_t totalSamples = frames * kChannels;
        if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
          s->buffer.insert(s->buffer.end(), totalSamples, 0);
        } else {
          s->buffer.insert(s->buffer.end(), pcmIn, pcmIn + totalSamples);
        }
        s->captureClient->ReleaseBuffer(frames);
      }
    }

    // Emit exactly kSampleRate frames per second, paced by the steady clock.
    // The previous `Sleep(10)` pacing really slept ~10.9-15.6 ms on Windows,
    // so the helper produced only ~44k frames/s for a 48 kHz stream: the
    // per-session buffers overflowed (audio dropped) and the renderer padded
    // the gaps with silence, drifting the live audio away from the video.
    const auto nowForPacing = std::chrono::steady_clock::now();
    const uint64_t elapsedUs = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::microseconds>(nowForPacing - pacingStart).count());
    const uint64_t framesDue = elapsedUs * kSampleRate / 1000000ULL;
    // After a long stall (pipe blocked, machine hiccup) do not burst the whole
    // backlog downstream - that backlog would become permanent latency.
    if (framesDue > framesEmitted + kMaxCatchUpFrames) {
      framesEmitted = framesDue - kMixFrames;
    }

    while (keepCapturing && framesEmitted + kMixFrames <= framesDue) {
      // Mix available frames across all sessions without blocking on silent processes.
      // A silent window on the monitor must NEVER stall audio from an active application.
      std::fill(mixBufferLeft.begin(), mixBufferLeft.end(), 0);
      std::fill(mixBufferRight.begin(), mixBufferRight.end(), 0);

      for (auto& pair : sessions) {
        auto& buf = pair.second->buffer;
        const size_t availableFrames = buf.size() / kChannels;
        const size_t framesToTake = (std::min)(static_cast<size_t>(kMixFrames), availableFrames);

        for (size_t f = 0; f < framesToTake; ++f) {
          mixBufferLeft[f] += buf[f * 2];
          mixBufferRight[f] += buf[f * 2 + 1];
        }

        if (framesToTake > 0) {
          buf.erase(buf.begin(), buf.begin() + (framesToTake * kChannels));
        }
      }

      for (UINT32 f = 0; f < kMixFrames; ++f) {
        int32_t l = mixBufferLeft[f];
        int32_t r = mixBufferRight[f];
        if (l > 32767) l = 32767; else if (l < -32768) l = -32768;
        if (r > 32767) r = 32767; else if (r < -32768) r = -32768;
        outputPcm[f * 2] = static_cast<int16_t>(l);
        outputPcm[f * 2 + 1] = static_cast<int16_t>(r);
      }

      keepCapturing = WriteAll(output, reinterpret_cast<const BYTE*>(outputPcm.data()), kMixFrames * kBytesPerFrame);
      if (keepCapturing) {
        framesEmitted += kMixFrames;
        bytesWritten += kMixFrames * kBytesPerFrame;
        for (const auto sample : outputPcm) {
          if (sample != 0) {
            nonSilentSamples++;
          }
        }
      }
    }

    // Bound each session's backlog so a stalled consumer can't turn into
    // permanent delay (keep at most ~60 ms queued per process).
    for (auto& pair : sessions) {
      auto& buf = pair.second->buffer;
      constexpr size_t kMaxBufferSamples = kMixFrames * kChannels * 6;
      if (buf.size() > kMaxBufferSamples) {
        buf.erase(buf.begin(), buf.end() - kMaxBufferSamples);
      }
    }

    Sleep(2);

    if (std::chrono::steady_clock::now() - lastStats >= std::chrono::seconds(2)) {
      std::wcerr << L"[process-audio-capture] STATS mode=screen sessions=" << sessions.size()
                 << L" scans=" << scanCount << L" bytes=" << bytesWritten
                 << L" nonSilentSamples=" << nonSilentSamples << L"\n";
      std::wcerr.flush();
      lastStats = std::chrono::steady_clock::now();
    }
  }

  timeEndPeriod(1);
  for (auto& pair : sessions) {
    pair.second->Dispose();
  }
  sessions.clear();
  return 0;
}

}  // namespace

int wmain(int argc, wchar_t* argv[]) {
  // Supported invocations:
  // 1. Window capture: process-audio-capture --source-id window:<HWND>:<index>
  // 2. Screen capture: process-audio-capture --source-id screen:<id> --screen-bounds <left> <top> <width> <height>
  if (argc < 3 || wcscmp(argv[1], L"--source-id") != 0) {
    std::wcerr << L"Usage: process-audio-capture --source-id <window:...|screen:...> [--screen-bounds left top width height]\n";
    return 2;
  }

  const wchar_t* sourceId = argv[2];
  const bool isScreen = (wcsncmp(sourceId, L"screen:", 7) == 0);

  HRESULT ro = RoInitialize(RO_INIT_MULTITHREADED);
  bool roInitialized = SUCCEEDED(ro);
  bool coInitialized = false;
  if (FAILED(ro) && ro != RPC_E_CHANGED_MODE) {
    const HRESULT co = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    coInitialized = SUCCEEDED(co);
    if (FAILED(co)) PrintError(L"COM initialization failed", co);
  }
  if (FAILED(ro) && ro != RPC_E_CHANGED_MODE && !coInitialized) {
    return 5;
  }

  int exitCode = 0;
  if (isScreen) {
    int left = 0, top = 0, width = 1920, height = 1080;
    for (int i = 3; i < argc; ++i) {
      if (wcscmp(argv[i], L"--screen-bounds") == 0 && i + 4 < argc) {
        left = _wtoi(argv[i + 1]);
        top = _wtoi(argv[i + 2]);
        width = _wtoi(argv[i + 3]);
        height = _wtoi(argv[i + 4]);
        break;
      }
    }
    exitCode = RunScreenCapture(left, top, width, height);
  } else {
    HWND targetWindow = nullptr;
    if (!ParseWindowHandle(sourceId, &targetWindow)) {
      std::wcerr << L"[process-audio-capture] The selected source is not a valid application window.\n";
      if (roInitialized) RoUninitialize();
      if (coInitialized) CoUninitialize();
      return 3;
    }
    exitCode = RunWindowCapture(targetWindow);
  }

  if (roInitialized) RoUninitialize();
  if (coInitialized) CoUninitialize();
  return exitCode;
}
