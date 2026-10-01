from pathlib import Path

import pytest

from app.config import ConfigurationError, Environment, load_settings


def test_loads_defaults() -> None:
    settings = load_settings({})

    assert settings.app_name == "Trivikrama AI Engine"
    assert settings.environment is Environment.DEVELOPMENT
    assert settings.port == 8000
    assert settings.expose_api_docs is True
    assert settings.models_dir == Path("models")
    assert settings.require_model_on_startup is False


def test_parses_production_settings_and_hides_docs() -> None:
    settings = load_settings(
        {
            "AI_APP_NAME": "Production AI",
            "AI_ENVIRONMENT": "PRODUCTION",
            "AI_HOST": "127.0.0.1",
            "AI_PORT": "9000",
            "AI_LOG_LEVEL": "warning",
            "AI_MODELS_DIR": "model-store",
        }
    )

    assert settings.environment is Environment.PRODUCTION
    assert settings.port == 9000
    assert settings.log_level == "WARNING"
    assert settings.expose_api_docs is False
    assert settings.models_dir == Path("model-store")
    assert settings.require_model_on_startup is True


@pytest.mark.parametrize(
    ("environment", "message"),
    [
        ({"AI_APP_NAME": "  "}, "AI_APP_NAME"),
        ({"AI_ENVIRONMENT": "staging"}, "AI_ENVIRONMENT"),
        ({"AI_PORT": "not-a-port"}, "AI_PORT"),
        ({"AI_PORT": "70000"}, "AI_PORT"),
        ({"AI_LOG_LEVEL": "TRACE"}, "AI_LOG_LEVEL"),
        ({"AI_MODELS_DIR": "  "}, "AI_MODELS_DIR"),
        ({"AI_REQUIRE_MODEL_ON_STARTUP": "sometimes"}, "AI_REQUIRE_MODEL"),
    ],
)
def test_rejects_invalid_configuration(environment: dict[str, str], message: str) -> None:
    with pytest.raises(ConfigurationError, match=message):
        load_settings(environment)
