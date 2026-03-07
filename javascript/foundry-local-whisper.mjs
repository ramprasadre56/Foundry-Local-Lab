/**
 * Whisper Voice Transcription with Foundry Local
 * Transcribes WAV audio files using the OpenAI Whisper model running locally.
 *
 * Uses the Foundry Local SDK to download and manage the whisper model, then
 * runs inference directly with ONNX Runtime Node. Audio preprocessing
 * (mel spectrogram extraction) is handled inline.
 *
 * Requires: foundry-local-sdk, onnxruntime-node
 * Usage: node foundry-local-whisper.mjs [path-to-wav-file]
 */

import { FoundryLocalManager } from "foundry-local-sdk";
import * as ort from "onnxruntime-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelAlias = "whisper-medium";

// Whisper model constants
const SAMPLE_RATE = 16000;
const N_FFT = 400;
const HOP_LENGTH = 160;
const N_MELS = 80;
const MAX_FRAMES = 3000; // 30 seconds
const NUM_LAYERS = 24;
const NUM_HEADS = 16;
const HEAD_SIZE = 64;

// ---- Audio file discovery ------------------------------------------------

const samplesDir = path.join(__dirname, "..", "samples", "audio");
let audioFiles;

if (process.argv[2]) {
  const filePath = process.argv[2];
  if (!fs.existsSync(filePath)) {
    console.error(`Audio file not found: ${filePath}`);
    process.exit(1);
  }
  audioFiles = [filePath];
} else {
  if (!fs.existsSync(samplesDir)) {
    console.error(`Samples directory not found: ${samplesDir}`);
    process.exit(1);
  }
  audioFiles = fs
    .readdirSync(samplesDir)
    .filter((f) => f.startsWith("zava-") && f.endsWith(".wav"))
    .sort()
    .map((f) => path.join(samplesDir, f));
  if (audioFiles.length === 0) {
    console.error(`No WAV files found in ${samplesDir}`);
    process.exit(1);
  }
}

// ---- Step 1: Use Foundry Local SDK to ensure the model is available ------

console.log(`Initialising Foundry Local with model: ${modelAlias}...`);
const manager = new FoundryLocalManager();
const modelInfo = await manager.init(modelAlias);
const cacheLocation = await manager.getCacheLocation();

const modelDir = path.join(
  cacheLocation,
  "Microsoft",
  modelInfo.id.replace(":", "-"),
  "cpu-fp32"
);

if (!fs.existsSync(modelDir)) {
  console.error(`Model directory not found: ${modelDir}`);
  process.exit(1);
}

console.log(`Model ready: ${modelInfo.id}`);
console.log(`Model path: ${modelDir}`);

// ---- Step 2: Load ONNX sessions and tokeniser ---------------------------

console.log("\nLoading ONNX encoder and decoder...");
const encoderSession = await ort.InferenceSession.create(
  path.join(modelDir, "whisper-medium_encoder_fp32.onnx"),
  { executionProviders: ["cpu"] }
);
const decoderSession = await ort.InferenceSession.create(
  path.join(modelDir, "whisper-medium_decoder_fp32.onnx"),
  { executionProviders: ["cpu"] }
);

// Load tokeniser vocabulary
const vocabJson = JSON.parse(
  fs.readFileSync(path.join(modelDir, "vocab.json"), "utf8")
);
const idToToken = Object.fromEntries(
  Object.entries(vocabJson).map(([k, v]) => [v, k])
);

// Special token IDs
const SOT = vocabJson["<|startoftranscript|>"];
const EOT = vocabJson["<|endoftext|>"];
const EN = vocabJson["<|en|>"];
const TRANSCRIBE = vocabJson["<|transcribe|>"];
const NOTIMESTAMPS = vocabJson["<|notimestamps|>"];
const INITIAL_TOKENS = [SOT, EN, TRANSCRIBE, NOTIMESTAMPS];

// Compute mel filterbank [n_mels x (n_fft/2 + 1)]
const melFilters = computeMelFilterbank(SAMPLE_RATE, N_FFT, N_MELS);

console.log("Models loaded and ready.\n");

// ---- Mel filterbank computation ------------------------------------------

/** Convert frequency in Hz to the mel scale. */
function hzToMel(hz) {
  return 2595.0 * Math.log10(1.0 + hz / 700.0);
}

/** Convert mel scale value back to Hz. */
function melToHz(mel) {
  return 700.0 * (Math.pow(10, mel / 2595.0) - 1.0);
}

/** Compute a mel filterbank matrix [nMels x numBins]. */
function computeMelFilterbank(sampleRate, nFft, nMels) {
  const numBins = Math.floor(nFft / 2) + 1;
  const fMin = 0;
  const fMax = sampleRate / 2;
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);

  // nMels + 2 evenly spaced points on the mel scale
  const melPoints = new Float64Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    melPoints[i] = melMin + (i * (melMax - melMin)) / (nMels + 1);
  }

  // Convert mel points to FFT bin indices
  const binFreqs = new Float64Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    binFreqs[i] = melToHz(melPoints[i]);
  }

  // FFT bin frequencies
  const fftFreqs = new Float64Array(numBins);
  for (let i = 0; i < numBins; i++) {
    fftFreqs[i] = (i * sampleRate) / nFft;
  }

  // Build triangular filterbank
  const filterbank = [];
  for (let m = 0; m < nMels; m++) {
    const row = new Float64Array(numBins);
    const lower = binFreqs[m];
    const centre = binFreqs[m + 1];
    const upper = binFreqs[m + 2];
    for (let f = 0; f < numBins; f++) {
      if (fftFreqs[f] >= lower && fftFreqs[f] <= centre && centre > lower) {
        row[f] = (fftFreqs[f] - lower) / (centre - lower);
      } else if (fftFreqs[f] > centre && fftFreqs[f] <= upper && upper > centre) {
        row[f] = (upper - fftFreqs[f]) / (upper - centre);
      }
    }

    // Slaney-style normalisation
    const enorm = 2.0 / (binFreqs[m + 2] - binFreqs[m]);
    for (let f = 0; f < numBins; f++) {
      row[f] *= enorm;
    }
    filterbank.push(row);
  }
  return filterbank;
}

// ---- Audio preprocessing helpers -----------------------------------------

/** Read a 16-bit PCM WAV file and return float samples resampled to 16 kHz. */
function readWav(filePath) {
  const buf = fs.readFileSync(filePath);
  // Parse WAV header
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);

  // Find "data" chunk
  let offset = 12;
  while (offset < buf.length - 8) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "data") {
      offset += 8;
      break;
    }
    offset += 8 + size;
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor((buf.length - offset) / bytesPerSample / numChannels);
  const samples = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const pos = offset + (i * numChannels + ch) * bytesPerSample;
      sum += buf.readInt16LE(pos) / 32768.0;
    }
    samples[i] = sum / numChannels;
  }

  // Simple resampling if needed
  if (sampleRate !== SAMPLE_RATE) {
    const ratio = sampleRate / SAMPLE_RATE;
    const newLen = Math.floor(totalSamples / ratio);
    const resampled = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      resampled[i] = samples[Math.floor(i * ratio)];
    }
    return resampled;
  }
  return samples;
}

/** Hann window of given length. */
function hannWindow(length) {
  const win = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / length));
  }
  return win;
}

/** Radix-2 FFT (in-place, Cooley-Tukey). Returns magnitude squared. */
function fft(re, im) {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  // FFT
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let uRe = 1, uIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const tRe = uRe * re[b] - uIm * im[b];
        const tIm = uRe * im[b] + uIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const newURe = uRe * wRe - uIm * wIm;
        uIm = uRe * wIm + uIm * wRe;
        uRe = newURe;
      }
    }
  }
}

/** Compute log-mel spectrogram features matching Whisper's preprocessor. */
function logMelSpectrogram(audio) {
  // Pad audio to 30 seconds
  const targetLen = SAMPLE_RATE * 30;
  const padded = new Float32Array(targetLen);
  padded.set(audio.subarray(0, Math.min(audio.length, targetLen)));

  const win = hannWindow(N_FFT);
  // FFT size must be power of 2
  const fftSize = 512; // next power of 2 >= N_FFT
  const numBins = N_FFT / 2 + 1;
  const numFrames = Math.floor((targetLen - N_FFT) / HOP_LENGTH) + 1;

  // Compute STFT magnitudes
  const magnitudes = new Float32Array(numFrames * numBins);
  for (let t = 0; t < numFrames; t++) {
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const start = t * HOP_LENGTH;
    for (let i = 0; i < N_FFT; i++) {
      re[i] = padded[start + i] * win[i];
    }
    fft(re, im);
    for (let f = 0; f < numBins; f++) {
      magnitudes[t * numBins + f] = re[f] * re[f] + im[f] * im[f];
    }
  }

  // Apply mel filterbank and take log
  const melSpec = new Float32Array(N_MELS * MAX_FRAMES);
  const actualFrames = Math.min(numFrames, MAX_FRAMES);
  for (let m = 0; m < N_MELS; m++) {
    for (let t = 0; t < actualFrames; t++) {
      let sum = 0;
      for (let f = 0; f < numBins; f++) {
        sum += melFilters[m][f] * magnitudes[t * numBins + f];
      }
      melSpec[m * MAX_FRAMES + t] = sum;
    }
  }

  // Clamp and log scale
  let logMax = -Infinity;
  for (let i = 0; i < melSpec.length; i++) {
    melSpec[i] = Math.log10(Math.max(melSpec[i], 1e-10));
    if (melSpec[i] > logMax) logMax = melSpec[i];
  }
  for (let i = 0; i < melSpec.length; i++) {
    melSpec[i] = Math.max((melSpec[i] - logMax) / 4.0 + 1.0, 0);
  }

  return melSpec;
}

/** Decode token IDs to text using the vocabulary. */
function decodeTokens(tokens) {
  // Whisper uses byte-level BPE; decode the Unicode byte sequences
  const byteDecoder = {};
  // Build byte-to-character mapping (inverse of bytes_to_unicode)
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  for (let i = 0; i < bs.length; i++) {
    byteDecoder[String.fromCharCode(cs[i])] = bs[i];
  }

  const bytes = [];
  for (const id of tokens) {
    const token = idToToken[id] || "";
    for (const ch of token) {
      if (ch in byteDecoder) bytes.push(byteDecoder[ch]);
    }
  }
  return Buffer.from(bytes).toString("utf8").trim();
}

// ---- Transcription function -----------------------------------------------

async function transcribe(audioPath) {
  const audio = readWav(audioPath);

  // Extract mel spectrogram features
  const melSpec = logMelSpectrogram(audio);
  const inputTensor = new ort.Tensor("float32", melSpec, [1, N_MELS, MAX_FRAMES]);

  // Run encoder
  const encoderOut = await encoderSession.run({ audio_features: inputTensor });
  const outputNames = Object.keys(encoderOut);

  // Prepare cross-attention KV cache from encoder outputs
  const crossKV = {};
  for (let i = 0; i < NUM_LAYERS; i++) {
    crossKV[`past_key_cross_${i}`] = encoderOut[`present_key_cross_${i}`];
    crossKV[`past_value_cross_${i}`] = encoderOut[`present_value_cross_${i}`];
  }

  // Initialise self-attention KV cache (empty)
  let selfKV = {};
  for (let i = 0; i < NUM_LAYERS; i++) {
    selfKV[`past_key_self_${i}`] = new ort.Tensor(
      "float32", new Float32Array(0), [1, NUM_HEADS, 0, HEAD_SIZE]
    );
    selfKV[`past_value_self_${i}`] = new ort.Tensor(
      "float32", new Float32Array(0), [1, NUM_HEADS, 0, HEAD_SIZE]
    );
  }

  // Autoregressive decoding
  let inputIds = new ort.Tensor(
    "int32", new Int32Array(INITIAL_TOKENS), [1, INITIAL_TOKENS.length]
  );
  const generated = [];

  for (let step = 0; step < 448; step++) {
    const feeds = { input_ids: inputIds, ...crossKV, ...selfKV };
    const outputs = await decoderSession.run(feeds);

    // Get logits and pick the most likely token
    const logits = outputs.logits;
    const vocabSize = logits.dims[2];
    const lastTokenLogits = logits.data.slice(-vocabSize);
    let maxIdx = 0, maxVal = -Infinity;
    for (let i = 0; i < lastTokenLogits.length; i++) {
      if (lastTokenLogits[i] > maxVal) { maxVal = lastTokenLogits[i]; maxIdx = i; }
    }

    if (maxIdx === EOT) break;
    generated.push(maxIdx);

    // Update self-attention KV cache
    const newSelfKV = {};
    for (let i = 0; i < NUM_LAYERS; i++) {
      newSelfKV[`past_key_self_${i}`] = outputs[`present_key_self_${i}`];
      newSelfKV[`past_value_self_${i}`] = outputs[`present_value_self_${i}`];
    }
    selfKV = newSelfKV;

    inputIds = new ort.Tensor("int32", new Int32Array([maxIdx]), [1, 1]);
  }

  return decodeTokens(generated);
}

// ---- Step 3: Transcribe each audio file -----------------------------------

for (const audioPath of audioFiles) {
  const filename = path.basename(audioPath);
  console.log("=".repeat(60));
  console.log(`File: ${filename}`);
  console.log("=".repeat(60));

  const t0 = Date.now();
  const text = await transcribe(audioPath);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(text);
  console.log(`(${elapsed}s)\n`);
}

console.log(`Done — transcribed ${audioFiles.length} file(s).`);
