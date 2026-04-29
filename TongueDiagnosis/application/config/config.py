import os
from pathlib import Path

from dotenv import load_dotenv


_env_path = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(dotenv_path=_env_path, override=False)


class Settings:
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24
    SECRET_KEY: str = os.getenv("SECRET_KEY", "f2e1f1b1c1a1")
    ALGORITHMS: str = "HS256"
    IMG_PATH: str = os.getenv("IMG_PATH", "frontend/public/tongue")
    IMG_DB_PATH: str = os.getenv("IMG_DB_PATH", "tongue")
    OLLAMA_PATH: str = os.getenv("OLLAMA_PATH", "http://localhost:11434/api/chat")
    SYSTEM_PROMPT: str = "You are now an AI traditional Chinese medicine doctor specializing in tongue diagnosis. At the very beginning, I will show you four image features of the user's tongue. Please use your knowledge of traditional Chinese medicine to give the user some suggestions. Answer in English"
    LLM_NAME: str = os.getenv("LLM_NAME", "deepseek-r1:14b")
    APP_PORT: int = int(os.getenv("APP_PORT", "5000"))

    ARK_API_KEY: str = os.getenv("ARK_API_KEY", "")
    ARK_MODEL_ID: str = os.getenv("ARK_MODEL_ID", "")
    ARK_BASE_URL: str = os.getenv(
        "ARK_BASE_URL",
        "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
    )
