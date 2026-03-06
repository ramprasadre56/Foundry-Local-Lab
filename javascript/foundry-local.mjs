import { OpenAI } from "openai";
import { FoundryLocalManager } from "foundry-local-sdk";

// By using an alias, the most suitable model variant will be
// downloaded for your end-user's device hardware.
const alias = "phi-3.5-mini";

// Create a FoundryLocalManager instance. This will start the Foundry
// Local service if it is not already running.
const manager = new FoundryLocalManager();

/**
 * Renders a CLI progress bar for model download.
 * @param {number} progress - Download progress percentage (0-100).
 */
function renderProgressBar(progress) {
  const barWidth = 30;
  const filled = Math.round((progress / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);
  process.stdout.write(`\r[Download] [${bar}] ${progress.toFixed(1)}%`);
  if (progress >= 100) {
    process.stdout.write("\n");
  }
}

// Step 1: Start the Foundry Local service
console.log("Starting Foundry Local service...");
await manager.startService();

// Step 2: Check if the model is already downloaded
const cachedModels = await manager.listCachedModels();
const catalogInfo = await manager.getModelInfo(alias);
const isAlreadyCached = cachedModels.some((m) => m.id === catalogInfo?.id);

// Step 3: Download model if needed (with progress), or skip
if (isAlreadyCached) {
  console.log(`Model already downloaded: ${alias}`);
} else {
  console.log(
    `Downloading model: ${alias} (this may take several minutes)...`
  );
  await manager.downloadModel(alias, undefined, false, (progress) => {
    renderProgressBar(progress);
  });
  console.log(`Download complete: ${alias}`);
}

// Step 4: Load the model into memory
console.log(`Loading model: ${alias}...`);
const modelInfo = await manager.loadModel(alias);
console.log("Model Info:", modelInfo);

// Configure the OpenAI client to use the local Foundry service
const client = new OpenAI({
  baseURL: manager.endpoint,
  apiKey: manager.apiKey, // API key is not required for local usage
});

// Generate a streaming chat completion
const stream = await client.chat.completions.create({
  model: modelInfo.id,
  messages: [{ role: "user", content: "What is the golden ratio?" }],
  stream: true,
});

// Print the streaming response
for await (const chunk of stream) {
  if (chunk.choices[0]?.delta?.content) {
    process.stdout.write(chunk.choices[0].delta.content);
  }
}
console.log(); // newline at end
