using Microsoft.AI.Foundry.Local;
using Microsoft.Agents.AI;
using OpenAI;
using OpenAI.Chat;
using System.ClientModel;

namespace Examples;

/// <summary>
/// Part 4: Single AI agent using the Microsoft Agent Framework.
/// Uses the AsAIAgent() extension from Microsoft.Agents.AI.OpenAI
/// to create a proper AIAgent backed by Foundry Local.
/// </summary>
public static class SingleAgent
{
    public static async Task RunAsync()
    {
        var alias = "phi-4-mini";

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

        // Create an AIAgent using the Agent Framework extension method
        AIAgent joker = client
            .GetChatClient(model?.ModelId)
            .AsAIAgent(
                instructions: "You are good at telling jokes. Keep your jokes short and family-friendly.",
                name: "Joker"
            );

        Console.WriteLine($"Agent: Joker");
        Console.WriteLine(new string('-', 40));

        // Run the agent with a prompt (non-streaming)
        var prompt = "Tell me a joke about a pirate.";
        Console.WriteLine($"User: {prompt}\n");

        var response = await joker.RunAsync(prompt);
        Console.WriteLine($"Joker: {response}\n");

        // Demonstrate streaming response
        var followUp = "Now tell me one about a programmer.";
        Console.WriteLine($"User: {followUp}\n");

        Console.Write("Joker: ");
        await foreach (var update in joker.RunStreamingAsync(followUp))
        {
            Console.Write(update);
        }
        Console.WriteLine();
    }
}
