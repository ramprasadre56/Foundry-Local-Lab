"""
Foundry Local — Retrieval-Augmented Generation (RAG) Example

Demonstrates a simple RAG pipeline that runs entirely on-device:
1. A small knowledge base of text chunks is defined locally.
2. A user question is answered by first retrieving the most relevant
   chunks (simple keyword overlap scoring) and then sending them as
   context to a local model via Foundry Local.

No cloud services, embeddings API, or vector database required.
"""

import openai
from foundry_local import FoundryLocalManager

# ── 1. Local knowledge base ─────────────────────────────────────────────────
KNOWLEDGE_BASE = [
    {
        "title": "Foundry Local Overview",
        "content": (
            "Foundry Local brings the power of Azure AI Foundry to your local "
            "device without requiring an Azure subscription. It allows you to "
            "run Generative AI models directly on your local hardware with no "
            "sign-up required, keeping all data processing on-device for "
            "enhanced privacy and security."
        ),
    },
    {
        "title": "Supported Hardware",
        "content": (
            "Foundry Local automatically selects the best model variant for "
            "your hardware. If you have an Nvidia CUDA GPU it downloads the "
            "CUDA-optimized model. For a Qualcomm NPU it downloads the "
            "NPU-optimized model. Otherwise it uses the CPU-optimized model. "
            "Performance is optimized through ONNX Runtime and hardware "
            "acceleration."
        ),
    },
    {
        "title": "OpenAI-Compatible API",
        "content": (
            "Foundry Local exposes an OpenAI-compatible REST API so you can "
            "use the standard OpenAI Python, JavaScript or C# SDKs to "
            "interact with local models. The endpoint is dynamically assigned "
            "— always obtain it from the SDK's manager.endpoint property "
            "rather than hard-coding a port number."
        ),
    },
    {
        "title": "Model Catalog",
        "content": (
            "You can browse all available models at foundrylocal.ai or by "
            "running 'foundry model list' in your terminal. Popular models "
            "include Phi-3.5-mini, Phi-4-mini, Qwen 2.5, Mistral, and "
            "DeepSeek-R1. Models are downloaded on first use and cached "
            "locally for future sessions."
        ),
    },
    {
        "title": "Installation",
        "content": (
            "On Windows install Foundry Local with: "
            "winget install Microsoft.FoundryLocal. "
            "On macOS install with: "
            "brew install microsoft/foundrylocal/foundrylocal. "
            "You can also download installers from the GitHub releases page."
        ),
    },
]


# ── 2. Simple keyword retrieval ─────────────────────────────────────────────
def retrieve(query: str, top_k: int = 2) -> list[dict]:
    """Return the top-k knowledge chunks most relevant to *query*
    using simple word-overlap scoring."""
    query_words = set(query.lower().split())
    scored = []
    for chunk in KNOWLEDGE_BASE:
        chunk_words = set(chunk["content"].lower().split())
        overlap = len(query_words & chunk_words)
        scored.append((overlap, chunk))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [item[1] for item in scored[:top_k]]


# ── 3. Generation with retrieved context ────────────────────────────────────
def main():
    # Start Foundry Local and load a model
    alias = "phi-3.5-mini"

    print("Starting Foundry Local service...")
    manager = FoundryLocalManager()
    manager.start_service()

    # Check if model is already downloaded
    cached = manager.list_cached_models()
    catalog_info = manager.get_model_info(alias)
    is_cached = any(m.id == catalog_info.id for m in cached) if catalog_info else False

    if is_cached:
        print(f"Model already downloaded: {alias}")
    else:
        print(f"Downloading model: {alias} (this may take several minutes)...")
        manager.download_model(alias)
        print(f"Download complete: {alias}")

    print(f"Loading model: {alias}...")
    manager.load_model(alias)

    client = openai.OpenAI(
        base_url=manager.endpoint,
        api_key=manager.api_key,
    )

    # User question
    question = "How do I install Foundry Local and what hardware does it support?"
    print(f"Question: {question}\n")

    # Retrieve relevant context
    context_chunks = retrieve(question)
    context_text = "\n\n".join(
        f"### {c['title']}\n{c['content']}" for c in context_chunks
    )
    print("--- Retrieved Context ---")
    print(context_text)
    print("-------------------------\n")

    # Build the prompt with retrieved context
    system_prompt = (
        "You are a helpful assistant. Answer the user's question using ONLY "
        "the information provided in the context below. If the context does "
        "not contain enough information, say so.\n\n"
        f"Context:\n{context_text}"
    )

    # Generate a response
    stream = client.chat.completions.create(
        model=manager.get_model_info(alias).id,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question},
        ],
        stream=True,
    )

    print("Answer:")
    for chunk in stream:
        if chunk.choices[0].delta.content is not None:
            print(chunk.choices[0].delta.content, end="", flush=True)
    print()


if __name__ == "__main__":
    main()
