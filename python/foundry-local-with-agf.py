import asyncio
from foundry_local import FoundryLocalManager
from agent_framework import ChatAgent
from agent_framework.openai import OpenAIChatClient


async def main():
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
    model_info = manager.get_model_info(alias)
    print(f"Model info: {model_info}")
    print(f"Foundry Local endpoint: {manager.endpoint}")

    # Create a single ChatAgent backed by the local model
    agent = ChatAgent(
        chat_client=OpenAIChatClient(
            model_id=model_info.id,
            base_url=manager.endpoint,
            api_key=manager.api_key,  # API key is not required for local usage
        ),
        instructions="You are good at telling jokes.",
        name="Joker",
    )

    # Run the agent with a user prompt
    result = await agent.run("Tell me a joke about a pirate.")
    print(result.text)


asyncio.run(main())