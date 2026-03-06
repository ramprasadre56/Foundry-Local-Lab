using Microsoft.AI.Foundry.Local;
using OpenAI;
using OpenAI.Chat;
using System.ClientModel;

namespace Examples;

/// <summary>
/// Part 4: Single AI agent with system instructions and conversation history.
/// Implements a lightweight ChatAgent class that wraps the OpenAI ChatClient
/// with a persistent system prompt and message history.
/// </summary>
public static class SingleAgent
{
    /// <summary>
    /// A minimal agent that wraps a ChatClient with instructions and history.
    /// </summary>
    private sealed class ChatAgent
    {
        private readonly ChatClient _chatClient;
        private readonly string _instructions;
        private readonly List<ChatMessage> _history = [];

        public string Name { get; }

        public ChatAgent(ChatClient chatClient, string name, string instructions)
        {
            _chatClient = chatClient;
            Name = name;
            _instructions = instructions;
            _history.Add(new SystemChatMessage(instructions));
        }

        /// <summary>
        /// Send a user message and return the assistant's full response.
        /// </summary>
        public string Run(string userMessage)
        {
            _history.Add(new UserChatMessage(userMessage));

            var completion = _chatClient.CompleteChat(_history);
            var reply = completion.Value.Content[0].Text;

            _history.Add(new AssistantChatMessage(reply));
            return reply;
        }
    }

    public static async Task RunAsync()
    {
        var alias = "phi-3.5-mini";

        // Step 1: Start the Foundry Local service
        Console.WriteLine("Starting Foundry Local service...");
        var manager = await FoundryLocalManager.StartServiceAsync();

        // Step 2: Check if the model is already downloaded
        var cachedModels = await manager.ListCachedModelsAsync();
        var catalogInfo = await manager.GetModelInfoAsync(aliasOrModelId: alias);
        var isCached = cachedModels.Any(m => m.ModelId == catalogInfo?.ModelId);

        if (isCached)
        {
            Console.WriteLine($"Model already downloaded: {alias}");
        }
        else
        {
            Console.WriteLine($"Downloading model: {alias} (this may take several minutes)...");
            await manager.DownloadModelAsync(aliasOrModelId: alias);
            Console.WriteLine($"Download complete: {alias}");
        }

        // Step 3: Load the model into memory
        Console.WriteLine($"Loading model: {alias}...");
        var model = await manager.LoadModelAsync(aliasOrModelId: alias);
        Console.WriteLine($"Loaded model: {model?.ModelId}");
        Console.WriteLine($"Endpoint: {manager.Endpoint}\n");

        var key = new ApiKeyCredential(manager.ApiKey);
        var client = new OpenAIClient(key, new OpenAIClientOptions
        {
            Endpoint = manager.Endpoint
        });
        var chatClient = client.GetChatClient(model?.ModelId);

        // Create a single agent with a personality
        var joker = new ChatAgent(
            chatClient,
            name: "Joker",
            instructions: "You are good at telling jokes. Keep your jokes short and family-friendly."
        );

        Console.WriteLine($"Agent: {joker.Name}");
        Console.WriteLine(new string('-', 40));

        // Run the agent with a prompt
        var prompt = "Tell me a joke about a pirate.";
        Console.WriteLine($"User: {prompt}\n");

        var response = joker.Run(prompt);
        Console.WriteLine($"{joker.Name}: {response}\n");

        // Demonstrate conversation continuity
        var followUp = "Now tell me one about a programmer.";
        Console.WriteLine($"User: {followUp}\n");

        var response2 = joker.Run(followUp);
        Console.WriteLine($"{joker.Name}: {response2}");
    }
}
