"""Reference-based metrics. Attenuating everything must not count as preserving speech."""
import numpy as np
from scipy import signal
from pystoi import stoi

RATE = 48000


def rms(samples):
    return float(np.sqrt(np.mean(np.square(samples, dtype=np.float64)))) if len(samples) else 0.0


def db(ratio):
    return float(20 * np.log10(max(float(ratio), 1e-12)))


def align(reference, recorded, max_delay=RATE):
    # The audio crosses two real AudioContexts; compensate delay, never time-warp.
    if rms(reference) < 1e-10 or rms(recorded) < 1e-10:
        raise ValueError('Cannot measure latency of a silent signal')
    correlations = signal.correlate(recorded, reference, mode='full', method='fft')
    zero = len(reference) - 1
    delay = int(np.argmax(correlations[zero:zero + max_delay + 1]))
    aligned = np.zeros(len(reference), dtype=np.float64)
    available = min(len(reference), len(recorded) - delay)
    if available > 0:
        aligned[:available] = recorded[delay:delay + available]
    return aligned, delay


def measure_capture(clean, noisy, raw, captured, speech_start, speech_end, max_delay=RATE):
    raw_aligned, raw_delay = align(noisy, raw)
    if rms(raw_aligned - noisy) / max(rms(noisy), 1e-12) > 0.03:
        raise ValueError('Capture dropped/drifted samples')
    if rms(captured) < 1e-10:
        enhanced, delay = np.zeros(len(clean)), None
    else:
        enhanced, delay = align(clean, captured, max_delay=max_delay)
    metrics = measure(clean, noisy, enhanced, speech_start, speech_end)
    if delay is not None and delay + len(clean) > len(captured):
        # A long call delay can leave trailing background outside the recording.
        # Padding this missing tail with zeros must not imply noise reduction.
        metrics['noiseReductionDb'] = None
    if rms(enhanced[speech_start:speech_end]) < 1e-10:
        return dict(delayMs=None, rawDelayMs=1000 * raw_delay / RATE,
                    processingDelayMs=None, delayUnavailableReason='speech erased', **metrics)
    if delay < raw_delay:
        raise ValueError('Invalid negative processing delay')
    return dict(delayMs=1000 * delay / RATE, rawDelayMs=1000 * raw_delay / RATE,
                processingDelayMs=1000 * (delay - raw_delay) / RATE,
                delayUnavailableReason=None, **metrics)


def measure(clean, noisy, output, speech_start, speech_end):
    speech = clean[speech_start:speech_end].astype(np.float64)
    enhanced = output[speech_start:speech_end].astype(np.float64)
    original = noisy[speech_start:speech_end].astype(np.float64)
    power = float(np.dot(speech, speech))
    gain = float(np.dot(enhanced, speech) / max(power, 1e-20))
    target = gain * speech
    error = enhanced - target
    si_sdr = float(10 * np.log10(max(np.dot(target, target), 1e-20) / max(np.dot(error, error), 1e-20)))
    input_gain = float(np.dot(original, speech) / max(power, 1e-20))
    input_error = original - input_gain * speech
    input_si_sdr = float(10 * np.log10(max(input_gain ** 2 * power, 1e-20) / max(np.dot(input_error, input_error), 1e-20)))
    intelligibility = float(stoi(speech, enhanced, RATE)) if rms(enhanced) > 1e-10 else 0.0
    input_stoi = float(stoi(speech, original, RATE))
    hop = RATE // 50
    frames = len(speech) // hop
    speech_rms = np.sqrt(np.mean(speech[:frames * hop].reshape(frames, hop) ** 2, axis=1))
    output_rms = np.sqrt(np.mean(enhanced[:frames * hop].reshape(frames, hop) ** 2, axis=1))
    active = speech_rms > max(float(np.max(speech_rms)) * 0.05, 1e-8)
    dropout = float(np.mean(output_rms[active] < speech_rms[active] * 0.1) * 100)
    # Last half-second is guaranteed noise-only, after release/hold have settled.
    noise_in, noise_out = noisy[-RATE // 2:], output[-RATE // 2:]
    noise_reduction = -db(rms(noise_out) / rms(noise_in)) if rms(noise_in) > 1e-10 else None
    return dict(stoi=intelligibility, inputStoi=input_stoi, siSdrDb=si_sdr,
                inputSiSdrDb=input_si_sdr, siSdrImprovementDb=si_sdr - input_si_sdr,
                speechGainDb=db(abs(gain)), dropoutPercent=dropout, noiseReductionDb=noise_reduction)
