using Microsoft.AI.Foundry.Local;
using Microsoft.Agents.AI;
using OpenAI;
using OpenAI.Chat;
using System.ClientModel;

namespace Examples;

/// <summary>
/// Part 5: Multi-agent workflow — Researcher → Writer → Editor pipeline.
/// Three AIAgent instances collaborate sequentially to produce a reviewed blog post.
/// Uses the Microsoft Agent Framework's AsAIAgent() extension method.
/// </summary>
public static class MultiAgent
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
        Console.WriteLine($"Model: {model?.ModelId}");
        Console.WriteLine($"Endpoint: {manager.Endpoint}\n");

        var key = new ApiKeyCredential(manager.ApiKey);
        var openAiClient = new OpenAIClient(key, new OpenAIClientOptions
        {
            Endpoint = manager.Endpoint
        });
        var chatClient = openAiClient.GetChatClient(model?.ModelId);

        // ── Define agents using AsAIAgent() ─────────────────────────────
        AIAgent researcher = chatClient.AsAIAgent(
            name: "Researcher",
            instructions:
                "You are a research assistant. When given a topic, provide a concise " +
                "collection of key facts, statistics, and background information. " +
                "Organize your findings as bullet points."
        );

        AIAgent writer = chatClient.AsAIAgent(
            name: "Writer",
            instructions:
                "You are a skilled blog writer. Using the research notes provided, " +
                "write a short, engaging blog post (3-4 paragraphs). " +
                "Include a catchy title. Do not make up facts beyond what is given."
        );

        AIAgent editor = chatClient.AsAIAgent(
            name: "Editor",
            instructions:
                "You are a senior editor. Review the blog post below for clarity, " +
                "grammar, and factual consistency with the research notes. " +
                "Provide a brief editorial verdict: ACCEPT if the post is " +
                "publication-ready, or REVISE with specific suggestions."
        );

        var topic = "The history and future of renewable energy";

        // ── Agent workflow: Researcher → Writer → Editor ────────────────
        Console.WriteLine(new string('=', 60));
        Console.WriteLine($"Topic: {topic}");
        Console.WriteLine(new string('=', 60));

        // Step 1 — Research
        Console.WriteLine("\n[Researcher] Gathering information...");
        var researchNotes = await researcher.RunAsync(
            $"Research the following topic and provide key facts:\n{topic}");
        Console.WriteLine($"\n--- Research Notes ---\n{researchNotes}\n");

        // Step 2 — Write
        Console.WriteLine("[Writer] Drafting the article...");
        var draft = await writer.RunAsync(
            $"Write a blog post based on these research notes:\n\n{researchNotes}");
        Console.WriteLine($"\n--- Draft Article ---\n{draft}\n");

        // Step 3 — Edit
        Console.WriteLine("[Editor] Reviewing the article...");
        var verdict = await editor.RunAsync(
            $"Review this article for quality and accuracy.\n\n" +
            $"Research notes:\n{researchNotes}\n\n" +
            $"Article:\n{draft}");
        Console.WriteLine($"\n--- Editor Verdict ---\n{verdict}\n");

        Console.WriteLine(new string('=', 60));
        Console.WriteLine("Multi-agent workflow complete!");
    }
}
