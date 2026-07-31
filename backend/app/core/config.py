"""应用配置：从环境变量 / .env 文件加载。"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 应用
    app_name: str = "Learning-Go"
    debug: bool = True

    # 数据库
    database_url: str = "sqlite:///./learning_go.db"

    # DeepSeek API（阶段三）
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"

    # KataGo（阶段二）
    katago_binary: str = "./katago/katago.exe"
    katago_model: str = "./katago/models/b18.bin.gz"
    katago_config: str = "./katago/katago.cfg"


@lru_cache
def get_settings() -> Settings:
    return Settings()
