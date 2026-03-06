import { OpenAI } from "openai";
import { FoundryLocalManager } from "foundry-local-sdk";

// ---------------------------------------------------------------------------
// Simple Agent class — wraps an OpenAI chat client with persistent
// system instructions, mirroring the ChatAgent pattern from the
// Microsoft Agent Framework (Python / C#).
// ---------------------------------------------------------------------------
class ChatAgent {
  constructor({ client, modelId, instructions, name }) {
    this.client = client;
    this.modelId = modelId;
    this.instructions = instructions;
    this.name = name;
    this.history = [];
  }

  async run(userMessage) {
    const messages = [
      { role: "system", content: this.instructions },
      ...this.history,
      { role: "user", content: userMessage },
    ];

    const response = await this.client.chat.completions.create({
      model: this.modelId,
      messages,
    });

    const assistantMessage = response.choices[0].message.content;

    // Keep conversation history for multi-turn interactions
    this.history.push({ role: "user", content: userMessage });
    this.history.push({ role: "assistant", content: assistantMessage });

    return { text: assistantMessage };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Create a FoundryLocalManager instance — starts the Foundry Local service
  const alias = "phi-3.5-mini";
  const manager = new FoundryLocalManager();

  // Step 1: Start the service
  console.log("Starting Foundry Local service...");
  await manager.startService();

  // Step 2: Check if model is already downloaded
  const cachedModels = await manager.listCachedModels();
  const catalogInfo = await manager.getModelInfo(alias);
  const isAlreadyCached = cachedModels.some((m) => m.id === catalogInfo?.id);

  if (isAlreadyCached) {
    console.log(`Model already downloaded: ${alias}`);
  } else {
    console.log(
      `Downloading model: ${alias} (this may take several minutes)...`
    );
    await manager.downloadModel(alias);
    console.log(`Download complete: ${alias}`);
  }

  // Step 3: Load the model into memory
  console.log(`Loading model: ${alias}...`);
  const modelInfo = await manager.loadModel(alias);
  console.log("Model Info:", modelInfo);
  console.log(`Foundry Local endpoint: ${manager.endpoint}`);

  // Create an OpenAI client pointing to the local Foundry service
  const client = new OpenAI({
    baseURL: manager.endpoint,
    apiKey: manager.apiKey,
  });

  // Create an agent with a specific persona
  const agent = new ChatAgent({
    client,
    modelId: modelInfo.id,
    instructions: "You are good at telling jokes.",
    name: "Joker",
  });

  // Run the agent
  const result = await agent.run("Tell me a joke about a pirate.");
  console.log(result.text);
}

main();
