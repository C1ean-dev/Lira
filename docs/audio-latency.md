# Real Lira audio latency measurement

The opt-in Electron test replays pinned MS-SNSD files through the current
`NoiseSuppressor.processStream`, `RnnoiseProcessor.processStream` and
`DeepFilterProcessor.processStream` implementations. The normal filters,
automatic gate, volume (100%) and 48 kHz contexts remain active. It does not
replace the processors with mocks and rejects startup failures or neural
fallbacks before and after each recording.

## Run

Install the pinned Python analysis dependencies from
`scripts/noise-benchmark/requirements.txt` into
`node_modules/.cache/noise-metrics` if they are not already available.

```powershell
$env:LIRA_RUN_AUDIO_BENCHMARK = '1'
$env:LIRA_AUDIO_PROFILE = 'validation'
$env:LIRA_AUDIO_OUTPUT = '.scratch/noise-benchmark/my-latency-run'
node --test scripts/noise-latency.electron.test.mjs
```

The integration starts an invisible Electron window with an isolated temporary
profile. It does not access the real microphone or modify the user's profile.
Starting Electron is opt-in under AGENTS.md; the user's request to measure the
real pipeline authorizes this run. Unit metric/mixture regressions run first.

## Method and limits

- Eight fixed validation scenarios use two speech recordings, with quiet clean
  speech, typing/air conditioning and door/neighbor noise. There are three
  seconds of background, five seconds of speech and one second of background.
- Speech and noise are scaled over the same speech interval. The exact clean
  reference and input float samples are saved and reused for all three engines.
- A single AudioWorklet records the reference and processed audio in separate
  channels of the same context, including one second of trailing capture.
- Correlation finds the lag of the original input in the raw capture and the lag
  of clean speech in the processed capture. Processing delay is the difference
  between these lags, so the scheduled recording/playback offset is removed.
- The capture must reproduce its input within 3% relative RMS error after a
  fixed shift. Silence and negative measured processing delay are rejected.
- These are measurements of the real local engine graphs and AudioContext /
  MediaStream buffers. They exclude physical microphone/speaker/Bluetooth and
  network/WebRTC latency; they are not mouth-to-ear measurements or Android/web
  device measurements. They are also not model startup times.
- Reported latency uses the median and range of measurable captures per engine.
  If speech is erased, latency is unavailable and is excluded from delay
  statistics, while its zero STOI remains in the intelligibility mean. A passing
  measurement test verifies captures/calculations, not that every engine sounds
  good or passes a quality target.
  STOI is computed after delay alignment. Mixed-speech means use six mixtures;
  the two quiet-clean cases are reported separately. STOI is intelligibility,
  not a percentage of words recognized or a complete perceptual-quality score.

Each output folder contains `report.json`, `run.json`, the exact renderer bundle
and its SHA-256, input/reference WAV and float files, raw/processed float
captures, and aligned processed WAVs. `run.json` records runtime versions and
per-capture context latency/readiness. Dataset audio remains in the local cache
and `.scratch`; it is not included in app builds.

Dataset: [Microsoft MS-SNSD](https://github.com/microsoft/MS-SNSD), pinned in
`scripts/noise-benchmark/manifest.json`; metric: [pystoi](https://github.com/mpariente/pystoi).
Original speech is 16 kHz, resampled to 48 kHz; this test cannot establish
full-band quality above the source bandwidth. Dataset licensing remains the
original MS-SNSD licensing.

## Measured on 2026-10-28

Windows, Electron 33.4.11 / Chromium 130.0.6723.191, 48 kHz, automatic gate,
100% input volume. Eight scenarios and 24 real-time captures, with no neural
fallback. The captured reference passed integrity checks for every recording.

| Engine | Median local delay | Observed delay range | Valid delays | Mixed STOI | Quiet-clean STOI |
| --- | --- | --- | --- | --- | --- |
| DeepFilterNet3 | 158.67 ms | 148.65–160.00 ms | 7/8 | 0.660 | 0.973 |
| RNNoise | 96.65 ms | 80.65–97.31 ms | 8/8 | 0.923 | 0.996 |
| Classic DSP | 48.33 ms | 46.65–64.65 ms | 8/8 | 0.881 | 0.979 |

Mean input STOI in the six mixtures was 0.895. DeepFilterNet3 erased the quiet
foreground speech in `voice347-AirConditioner-5-quiet` (100% active-frame
dropout, zero STOI). That capture cannot establish speech delay and is excluded
only from delay statistics. Its quality failure remains in the mixed STOI mean.
RNNoise had the highest mixed STOI in this subset. These observations do not
establish a universal ranking across different voices/devices/noises.

Actual captures, renderer bundle and full report:
`.scratch/noise-benchmark/lira-delay-2026-10-28/report.json`.
The fixed delay scorer was re-run on these original float captures after adding
regressions for erased speech; audio and engine settings were not changed.

To re-analyze the saved captures without recording again, set
`LIRA_AUDIO_REPLAY_ONLY=1` and the same `LIRA_AUDIO_OUTPUT`, then run the test.

## Bidirectional Lira conversation measurement

The engine-only numbers above do not include a call. The separate opt-in test
below measures two independent Lira participants using real MediaManager,
PeerManager, ICE/DTLS/SRTP, Opus and the receiver's normal media attachment and
volume graph. It uses the same pinned Microsoft MS-SNSD validation fixtures.

```powershell
$env:LIRA_RUN_CONVERSATION_BENCHMARK='1'
$env:LIRA_AUDIO_OUTPUT='.scratch/noise-benchmark/lira-conversation-2026-10-28'
node --test scripts/conversation-latency.electron.test.mjs
```

There are four pairs of scenarios, with different source recordings in each
direction. Both participants speak simultaneously, exercising full duplex.
Each pair runs with classic DSP, RNNoise, DeepFilterNet3 and an unprocessed
control. The control sends the exact virtual microphone through PeerManager;
it bypasses MediaManager's filter graph and does not represent the UI's
suppression toggle. The three engine runs use the real MediaManager path with
automatic sensitivity and 100% input/output volume. Neural fallback is rejected
rather than credited to the requested model.

An isolated Electron window hosts two same-origin realms with independent
stores, profiles and PeerManager instances. One instrumentation AudioContext
feeds the synthetic microphones and records six stages in each direction:
source reference, virtual microphone bridge, local processed stream, remote
decoded stream, receiver gain stream, and audio-element capture. This puts both
directions on the same sample clock without assuming synchronized computers.
The receiver also attaches the original stream to a muted video, as the actual
grid/mini call tiles do. Omitting that consumer reproduced Chromium's remote
stream/WebAudio silence issue and correctly failed the unfiltered control.

Delay is received-speech lag minus source-reference lag. It retains filter,
transport and receiver graph buffering, while removing the recorder's scheduled
start offset. Exact reference integrity, bidirectional RTP counters, actual
decoded samples, codec, model readiness and complete scenario coverage are
checked. Uncorrelated comfort noise cannot establish speech latency. Erased or
uncorrelated speech remains in the quality results, with unavailable latency.
STOI is calculated against clean speech after a fixed time shift, without
changing gain or time-warping the received signal.

The final capture contains the media player's stream content. It is not a
physical speaker/microphone or WASAPI output-loopback recording.
[`captureStream()` content is independent of physical rendering](https://w3c.github.io/mediacapture-fromelement/).
Consequently this is a measured **local software conversation path**, including
synthetic input/capture bridges; it does not establish physical mouth-to-ear
delay, driver/DAC/Bluetooth latency, or media-element-to-device scheduling.
Do not add `AudioContext.outputLatency` to it and label the result measured.
Both clients also share one machine's CPU. External internet, another computer,
Android and other web devices remain separate experiments.

The report is `conversation-report.json`; `conversation-run.json` preserves
runtime versions, renderer hashes, settings, per-participant packet counters and
decoder statistics. Twelve float capture channels are retained per call.
Each scenario also receives `conversation-<engine>.wav`, aligned for comparing
sound quality. Set `LIRA_AUDIO_REPLAY_ONLY=1` to rerun the tests and scorer on
saved captures. `LIRA_CONVERSATION_SMOKE=1` selects two clean scenarios and the
unprocessed/RNNoise modes for a shorter harness check.

### Conversation results on 2026-10-28

**Update:** these initial captures include a strong startup timing transient.
The subsequent [investigation and stage measurements](deepfilter-call-investigation.md)
found time-varying receiver delay and a separate gate effect. DeepFilter's
steady-call result was 228 ms median and 0.929 quiet-clean STOI in that follow-up;
the 734 ms / low STOI below describe the original startup experiment.

Sixteen calls produced 32 directional recordings in Electron 33.4.11 on this
Windows machine. All requested neural engines stayed ready without fallback.
The table uses received audio, with a fixed speech alignment. STOI is
intelligibility, not a percentage of recognized words.

| Mode | Median one-way software delay | Observed range | Measurable delays | Mixed STOI | Quiet-clean STOI |
| --- | --- | --- | --- | --- | --- |
| DeepFilterNet3 | 733.93 ms | 470.04–897.00 ms | 4/8 | 0.228 | 0.183 |
| RNNoise | 142.88 ms | 135.98–193.23 ms | 8/8 | 0.902 | 0.947 |
| Classic DSP | 129.47 ms | 121.85–146.81 ms | 8/8 | 0.876 | 0.926 |
| Unprocessed call control | 134.98 ms | 125.06–141.31 ms | 8/8 | 0.890 | 0.935 |

Input mixed STOI was 0.895. Delay ranges overlap between the unprocessed,
classic and RNNoise calls; independent calls negotiate/adapt their own receiver
buffers. These values are observed conversation delays rather than a fixed
per-filter cost that can be added/subtracted from every call.

DeepFilterNet was unstable in this complete path. Its local processed-stream
median delay was 159.33 ms, while the received path was much slower. Its local
quiet-clean STOI was 0.963/0.968; the corresponding received STOI was
0.145/0.222. WebRTC reported zero lost packets and zero concealed samples, with
mean jitter-buffer residence of approximately 412–926 ms across the DeepFilter
receivers during recording. This locates a major additional problem after the
local filter; its underlying cause still needs a controlled comparison.
The quiet air-conditioner case also lost the foreground voice at the local
filter (local STOI 0, 100% received active-frame dropout).

Four DeepFilter captures had insufficient speech correlation to establish
latency. They remain in the quality mean. Its four measured delays therefore
describe only the alignable captures; the current result does not establish a
stable DeepFilter conversation latency. Its received STOI also reflects timing
instability in the current integration. Both participants shared the same CPU.

The scorer originally searched only one second including recording lead-in.
A regression with a known 1.2-second delay exposed that limit. The final scorer
searches up to the available complete speech window (capped at three seconds),
and these results were recalculated from the original, unchanged recordings.
The captured speech interval fits at every accepted lag. Missing trailing
background is not credited as noise reduction. The current recorder keeps
three trailing seconds for future runs; this original run kept one second.

Full data: `.scratch/noise-benchmark/lira-conversation-2026-10-28/conversation-report.json`.
Fifteen metric/dataset regressions and the complete saved-capture validation
passed. Passing the measurement test confirms data/checks, while the DeepFilter
conversation result remains a quality/performance failure to investigate.

Compare the same quiet voice with typing noise, without loudness normalization
(received WAVs are time-aligned for listening):

- [Clean reference](../.scratch/noise-benchmark/lira-conversation-2026-10-28/voice113-Typing-5-quiet/clean.wav)
- [Noisy virtual microphone](../.scratch/noise-benchmark/lira-conversation-2026-10-28/voice113-Typing-5-quiet/input.wav)
- [Received DeepFilterNet](../.scratch/noise-benchmark/lira-conversation-2026-10-28/voice113-Typing-5-quiet/conversation-deepfilter.wav)
- [Received RNNoise](../.scratch/noise-benchmark/lira-conversation-2026-10-28/voice113-Typing-5-quiet/conversation-rnnoise.wav)
- [Received classic DSP](../.scratch/noise-benchmark/lira-conversation-2026-10-28/voice113-Typing-5-quiet/conversation-classic.wav)
- [Received unprocessed control](../.scratch/noise-benchmark/lira-conversation-2026-10-28/voice113-Typing-5-quiet/conversation-bypass.wav)
