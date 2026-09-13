from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FB_", env_file=".env", extra="ignore")

    db_host: str = "127.0.0.1"
    db_port: int = 3306
    db_user: str = "focusbutler"
    db_password: str = ""
    db_name: str = "focusbutler"

    jwt_secret: str = "change-me"
    jwt_expire_days: int = 7
    cookie_secure: bool = False

    data_dir: Path = Path("data")
    max_chunk_mb: int = 20
    register_rate_per_minute: int = 5

    @property
    def db_url(self) -> URL:
        # 用 URL.create 而不是拼字符串，密码里的 ! @ / 等字符不用手动转义
        return URL.create(
            "mysql+aiomysql",
            username=self.db_user,
            password=self.db_password,
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
            query={"charset": "utf8mb4"},
        )

    @property
    def video_dir(self) -> Path:
        return self.data_dir / "videos"


settings = Settings()
