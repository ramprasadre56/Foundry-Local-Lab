using Microsoft.AI.Foundry.Local;
using OpenAI;
using OpenAI.Chat;
using System.ClientModel;

namespace Examples;

/// <summary>
/// Part 2: Basic streaming chat completion with Foundry Local.
/// </summary>
public static class BasicChat
{
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

        // Create an OpenAI client pointing to the local service
        var key = new ApiKeyCredential(manager.ApiKey);
        var client = new OpenAIClient(key, new OpenAIClientOptions
        {
            Endpoint = manager.Endpoint
        });

        var chatClient = client.GetChatClient(model?.ModelId);

        // Stream a response
        var completionUpdates = chatClient.CompleteChatStreaming("What is the golden ratio?");

        foreach (var update in completionUpdates)
        {
            if (update.ContentUpdate.Count > 0)
            {
                Console.Write(update.ContentUpdate[0].Text);
            }
        }
        Console.WriteLine();
    }
}
