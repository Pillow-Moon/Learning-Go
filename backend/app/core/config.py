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

    # KataGo（模型收敛：仅 b11c768h12 本地分析模型 + WASM b6c96）
    katago_binary: str = "./katago/katago.exe"
    katago_model: str = "./katago/models/b11c768h12.bin.gz"
    katago_analysis_config: str = "./katago/katago_analysis.cfg"


@lru_cache
def get_settings() -> Settings:
    return Settings()
