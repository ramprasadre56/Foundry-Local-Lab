using Microsoft.AI.Foundry.Local;
using OpenAI;
using OpenAI.Chat;
using System.ClientModel;

namespace Examples;

/// <summary>
/// Part 5: Multi-agent workflow — Researcher → Writer → Editor pipeline.
/// Three agents collaborate sequentially to produce a reviewed blog post.
/// </summary>
public static class MultiAgent
{
    /// <summary>
    /// A minimal agent that wraps a ChatClient with instructions and history.
    /// </summary>
    private sealed class ChatAgent
    {
        private readonly ChatClient _chatClient;
        private readonly List<ChatMessage> _history = [];

        public string Name { get; }

        public ChatAgent(ChatClient chatClient, string name, string instructions)
        {
            _chatClient = chatClient;
            Name = name;
            _history.Add(new SystemChatMessage(instructions));
        }

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
        Console.WriteLine($"Model: {model?.ModelId}");
        Console.WriteLine($"Endpoint: {manager.Endpoint}\n");

        var key = new ApiKeyCredential(manager.ApiKey);
        var client = new OpenAIClient(key, new OpenAIClientOptions
        {
            Endpoint = manager.Endpoint
        });
        var chatClient = client.GetChatClient(model?.ModelId);

        // ── Define agents ───────────────────────────────────────────────
        var researcher = new ChatAgent(
            chatClient,
            name: "Researcher",
            instructions:
                "You are a research assistant. When given a topic, provide a concise " +
                "collection of key facts, statistics, and background information. " +
                "Organize your findings as bullet points."
        );

        var writer = new ChatAgent(
            chatClient,
            name: "Writer",
            instructions:
                "You are a skilled blog writer. Using the research notes provided, " +
                "write a short, engaging blog post (3-4 paragraphs). " +
                "Include a catchy title. Do not make up facts beyond what is given."
        );

        var editor = new ChatAgent(
            chatClient,
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
        var researchNotes = researcher.Run(
            $"Research the following topic and provide key facts:\n{topic}");
        Console.WriteLine($"\n--- Research Notes ---\n{researchNotes}\n");

        // Step 2 — Write
        Console.WriteLine("[Writer] Drafting the article...");
        var draft = writer.Run(
            $"Write a blog post based on these research notes:\n\n{researchNotes}");
        Console.WriteLine($"\n--- Draft Article ---\n{draft}\n");

        // Step 3 — Edit
        Console.WriteLine("[Editor] Reviewing the article...");
        var verdict = editor.Run(
            $"Review this article for quality and accuracy.\n\n" +
            $"Research notes:\n{researchNotes}\n\n" +
            $"Article:\n{draft}");
        Console.WriteLine($"\n--- Editor Verdict ---\n{verdict}\n");

        Console.WriteLine(new string('=', 60));
        Console.WriteLine("Multi-agent workflow complete!");
    }
}
