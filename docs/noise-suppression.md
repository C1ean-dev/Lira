# Noise suppression evaluation

The goal is to reduce background noise while preserving quiet speech, consonants
and word endings. Overall attenuation alone is not a quality score.

## Reproduce

Use Node dependencies from `npm ci`, Python (validated with 3.14) and the pinned analysis packages:

```powershell
python -m pip install --target node_modules/.cache/noise-metrics -r scripts/noise-benchmark/requirements.txt
python -B scripts/noise-benchmark/test_metrics.py
python -B scripts/noise-benchmark/test_report.py
python -B scripts/noise-benchmark/test_dataset.py
npm run test:noise -- --dynamics-only --output=.scratch/noise-benchmark/dynamics
npm run test:noise -- --profile=smoke --output=.scratch/noise-benchmark/smoke
npm run test:noise -- --profile=full --output=.scratch/noise-benchmark/full
```

`LIRA_PYTHON` can select another Python executable. The full dataset benchmark is
opt-in because it downloads public data and records real-time audio. `test:all`
includes the fast, network-free dynamics regression, which needs no Python metric
packages. It can also be run with `npm run test:noise:dynamics`.

The `full` profile has 20 fixed scenarios: two speech clips, quiet and normal
speech, air conditioner, typing, babble and vacuum cleaner, at 0 and 10 dB SNR.
The eight-case `validation` profile uses two other clips, quiet speech mixed with
typing/air conditioning, and door/neighbor noise. It must be
kept separate from parameter selection. The identifiers refer to speech files,
not verified speaker identities.

Each input includes three seconds of background, five seconds of speech and one
second of background. Quiet clean speech is RMS 0.0045; normal clean speech is
RMS 0.04. Regular mixtures use speech RMS 0.03; quiet validation mixtures use
0.0045, before a shared headroom adjustment. The mixture is identical for every
engine; no output loudness normalization is applied.
Noise is scaled using the same five-second speech interval as the clean signal,
including for nonstationary sounds such as typing. `snrDb` is the target and
`measuredSnrDb` records the resulting input SNR. A shared headroom adjustment
preserves this ratio. Earlier artifacts normalized noise over all nine seconds;
their typing mixtures were about 1.28 dB noisier during speech than their labels.
Regenerate both comparison inputs with the current preparer (a saved renderer
bundle can still be replayed); the byte-identity check rejects old/new mixtures.

## Actual processing and artifacts

The runner bundles `NoiseSuppressor`, `SoftDspProcessor` and `RnnoiseProcessor`,
then plays the inputs through their real `processStream` methods in the installed
Electron. RNNoise must become ready and remain ready: a raw/Soft DSP fallback
fails the run. An AudioWorklet captures both the reference and the processed
stream. The normal automatic gate, filtering and dynamics remain active.
Returning an unprocessed fallback stream also fails the run; it cannot masquerade
as perfect speech preservation.

`rnnoise-open` is a diagnostic control using manual sensitivity zero. It isolates
the neural denoiser from the additional gate; it is not another user-facing mode.

Each output directory contains `report.json`, `run.json`, the exact renderer
bundle, input/clean/processed WAVs and lossless float captures. The run records
the source bundle hash, dataset revision and Electron/Chromium versions. To run
the original implementation after making changes, use its saved bundle:

```powershell
npm run test:noise -- --profile=validation --bundle=.scratch/noise-benchmark/baseline-full/renderer.js --reference --output=.scratch/noise-benchmark/baseline-validation
npm run test:noise -- --profile=validation --output=.scratch/noise-benchmark/validation --compare=.scratch/noise-benchmark/baseline-validation/report.json
```

The checker verifies identical reference/mixture bytes, rejects noise-only
amplification above 1 dB, paired STOI losses above 0.03 and average losses above
0.005. Clean inputs must keep STOI >= 0.9, coherent speech gain >= -9 dB and
dropout <= 10%, so muting or uniformly attenuating everything cannot pass.
Mixtures must also retain STOI >= 0.5 and coherent speech gain >= -18 dB to
reject catastrophic voice loss without a baseline. Paired comparisons reject
speech-gain losses above 3 dB on any input, including mixtures: STOI alone cannot
detect uniform attenuation. Mixture dropout is not a pass/fail criterion because
noise can hide missing speech. The standard-library checker regressions run in
`test:all`; the dataset benchmark also runs the metric, checker and mixture tests
before preparing inputs.
These are regression budgets, not published perceptual-quality standards.
The checker supplements comparison of the complete metrics; passing it is not
a universal audio-quality guarantee.
`--reference` records a saved baseline bundle without applying the current quality
budgets; normal runs always apply them.

## Metrics

* STOI estimates intelligibility from the clean reference. It is not a percentage
  of words recognized or a listener quality rating. Higher is better.
* SI-SDR compares the coherent speech component with residual distortion/noise;
  it is invariant to uniform gain. Nonlinear denoisers can improve intelligibility
  while scoring worse here, so it is never the sole selection criterion.
* Speech gain measures the coherent reference component in dB. Clean-speech
  dropout counts active 20 ms frames attenuated by more than 20 dB. These expose
  voice loss that a scale-invariant score could hide. Dropout is only interpreted
  on clean inputs, since noise can mask missing speech in mixtures.
* Noise reduction measures the last half-second without foreground speech. A
  negative value means the engine amplified that background. Babble/neighbor
  speech is included as interference; an ordinary denoiser cannot identify the
  intended speaker from microphone audio alone.

Correlation compensates fixed delay, without time warping. A separate raw capture
must match its source within 3% relative RMS error or scoring fails. Metric tests
cover identity, total mute, uniform attenuation and capture delay.

## First measured correction

Clássico and Suave used low compressor thresholds with Web Audio's implicit
makeup gain. The initial MS-SNSD smoke run increased noise-only background by
4.3–8.9 dB. Both dynamics stages now cancel the specified makeup gain while
preserving their original compression curves. Weaker compression regressed typing
and door-slam cases, so the final change only removes the fixed gain. The
compensation follows Chromium's exponential soft-knee curve and is checked using
actual Web Audio rendering. Live audio and calibration previews share the same
presets. Gate thresholds and the RNNoise model remain independent of this stage.

Reference: [Web Audio makeup gain](https://www.w3.org/TR/webaudio-1.0/#computing-the-makeup-gain).

## Recorded results (2026-10-26, Windows Electron)

The historical matrices below used the original nine-second noise scaling.
Their paired before/after comparisons remain valid for those identical inputs;
new runs use speech-window SNR and must generate fresh comparison inputs.

The 20-case calibration matrix had mean noisy-input STOI 0.840. Means below
include four clean and sixteen mixed inputs per engine:

| Engine | Clean STOI before → after | Mixed STOI before → after |
| --- | --- | --- |
| Clássico | 0.966 → 0.963 | 0.814 → 0.813 |
| Suave | 0.984 → 0.989 | 0.833 → 0.833 |
| RNNoise, unchanged reference | 0.997 | 0.900 |

The DSP correction is level control, not improved source separation. Their mean
noise-only gain changed from +7.8 to -0.4 dB (Clássico) and +4.9 to +0.1 dB
(Suave). Speech is scaled by the same fixed compensation. The original dynamics
and gate behavior are retained; the small STOI differences do not establish a
statistically significant intelligibility improvement.

RNNoise was the strongest existing engine for the stated preservation/suppression
goal. Its mixed-speech results, grouped by interference, were:

| Interference | Input STOI | RNNoise STOI |
| --- | --- | --- |
| Air conditioning | 0.892 | 0.932 |
| Typing | 0.822 | 0.906 |
| Babble | 0.804 | 0.872 |
| Vacuum cleaner | 0.842 | 0.889 |

No neural weights or RNNoise gate parameters were changed. These are objective
subset measurements; listen to the saved WAVs for artifacts/naturalness. Very
large noise-only attenuation figures in JSON can indicate near digital silence,
not an equally large perceptual benefit.

Artifacts: `.scratch/noise-benchmark/baseline-full/report.json` and
`.scratch/noise-benchmark/final-full/report.json`. The original renderer is saved
with the baseline, so comparisons can replay it after source changes.

The eight additional cases had mean noisy-input STOI 0.886:

| Engine | Quiet clean STOI before → after | Mixed STOI before → after |
| --- | --- | --- |
| Clássico | 0.979 → 0.979 | 0.873 → 0.873 |
| Suave | 0.987 → 0.988 | 0.874 → 0.881 |
| RNNoise, unchanged reference | 0.996 | 0.917 |

The final comparisons passed the paired intelligibility, clean-voice preservation,
capture-integrity and noise-amplification checks. Reports are in
`.scratch/noise-benchmark/baseline-validation/report.json` and
`.scratch/noise-benchmark/final-validation/report.json`. Earlier experimental
reports remain under different names; they are not the accepted implementation.

## Dataset and scope

Sources are pinned in `scripts/noise-benchmark/manifest.json` to MS-SNSD commit
`fe61c4ba0d9ac8dd7e23d719cc79f8947e1dc742`. Downloads are verified against Git blob
hashes and cached in `node_modules/.cache/ms-snsd`; recordings stay in `.scratch`.
No dataset audio is bundled in the application or committed to the repository.

The original recordings are 16 kHz. Polyphase resampling feeds the actual 48 kHz
engines, but adds no information above 8 kHz. This is a small, reproducible subset,
not an official score on the entire dataset. Device echo cancellation, hardware
AGC, room reverberation and physical microphones require separate validation.

Dataset: [Microsoft MS-SNSD](https://github.com/microsoft/MS-SNSD).
Metric implementation: [pystoi](https://github.com/mpariente/pystoi).
The corrected speech-window SNR preparer was checked with four smoke and eight
validation scenarios (36 real captures across three engines). All passed the
stronger voice-preservation and noise-amplification budgets; validation mixed
STOI means were 0.880 (Clássico), 0.892 (Suave), 0.923 (RNNoise), versus 0.895
for the input. These are fresh inputs and are not paired improvements over the
historical matrices above. The RNNoise model and gate settings are unchanged.
The dataset retains its original speech/noise licenses described in the
[MS-SNSD README](https://github.com/microsoft/MS-SNSD#dataset-licenses); the repo's
MIT code license does not replace those data licenses.

Citation: Chandan K. A. Reddy et al., “A Scalable Noisy Speech Dataset and Online
Subjective Test Framework,” Interspeech 2019, pp. 1816–1820.
