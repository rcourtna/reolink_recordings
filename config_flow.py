"""Config flow for Reolink Recordings integration."""
import voluptuous as vol
import logging
from typing import Any, Dict, Optional

from homeassistant import config_entries
from homeassistant.core import HomeAssistant, callback
from homeassistant.const import (
    CONF_HOST,
    CONF_NAME,
    CONF_USERNAME,
    CONF_PASSWORD,
    CONF_SCAN_INTERVAL,
)
from homeassistant.data_entry_flow import FlowResult
import homeassistant.helpers.config_validation as cv

from .const import (
    DOMAIN,
    DEFAULT_SCAN_INTERVAL,
    CONF_STORAGE_PATH,
    DEFAULT_STORAGE_PATH,
    CONF_SNAPSHOT_FORMAT,
    DEFAULT_SNAPSHOT_FORMAT,
    SNAPSHOT_FORMAT_GIF,
    SNAPSHOT_FORMAT_JPG,
    SNAPSHOT_FORMAT_BOTH,
    CONF_ENABLE_CACHING,
    DEFAULT_ENABLE_CACHING,
    CONF_MEDIA_PLAYER,
    DEFAULT_MEDIA_PLAYER,
)

_LOGGER = logging.getLogger(__name__)


class ReolinkRecordingsConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Reolink Recordings."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Get the options flow for this handler."""
        return ReolinkRecordingsOptionsFlow(config_entry)

    async def async_step_user(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors: Dict[str, str] = {}

        if user_input is not None:
            # Validate the provided data
            # For now, we'll just check if we can connect to Home Assistant
            # In a production component, you would validate credentials here
            try:
                # Check if this config already exists
                await self.async_set_unique_id(f"{user_input[CONF_HOST]}")
                self._abort_if_unique_id_configured()

                # Return the config entry
                return self.async_create_entry(
                    title=user_input[CONF_NAME],
                    data=user_input,
                )
            except Exception as ex:
                _LOGGER.error(f"Error validating input: {ex}")
                errors["base"] = "cannot_connect"

        # Show the form
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_NAME, default="Reolink Recordings"): str,
                    vol.Required(CONF_HOST, default="http://localhost:8123"): str,
                    vol.Required(CONF_USERNAME): str,
                    vol.Required(CONF_PASSWORD): str,
                }
            ),
            errors=errors,
        )


class ReolinkRecordingsOptionsFlow(config_entries.OptionsFlow):
    """Handle options for Reolink Recordings."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Handle options flow."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        options = {
            vol.Optional(
                CONF_SCAN_INTERVAL,
                default=self.config_entry.options.get(
                    CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL
                ),
            ): vol.All(vol.Coerce(int), vol.Range(min=1, max=60)),
            vol.Optional(
                CONF_STORAGE_PATH,
                default=self.config_entry.options.get(
                    CONF_STORAGE_PATH, DEFAULT_STORAGE_PATH
                ),
            ): str,
            vol.Optional(
                CONF_SNAPSHOT_FORMAT,
                default=self.config_entry.options.get(
                    CONF_SNAPSHOT_FORMAT, DEFAULT_SNAPSHOT_FORMAT
                ),
            ): vol.In([
                SNAPSHOT_FORMAT_GIF,
                SNAPSHOT_FORMAT_JPG,
                SNAPSHOT_FORMAT_BOTH
            ]),
            vol.Optional(
                CONF_ENABLE_CACHING,
                default=self.config_entry.options.get(
                    CONF_ENABLE_CACHING, DEFAULT_ENABLE_CACHING
                ),
            ): bool,
            vol.Optional(
                CONF_MEDIA_PLAYER,
                default=self.config_entry.options.get(
                    CONF_MEDIA_PLAYER, DEFAULT_MEDIA_PLAYER
                ),
            ): str,
        }

        return self.async_show_form(step_id="init", data_schema=vol.Schema(options))
