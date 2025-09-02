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
    CONF_RESOLUTION_PREFERENCE,
    DEFAULT_RESOLUTION_PREFERENCE,
    RESOLUTION_HIGH,
    RESOLUTION_LOW,
    CONF_UPLOAD_DELAY,
    DEFAULT_UPLOAD_DELAY,
    CONF_ENABLE_EVENT_DRIVEN,
    DEFAULT_ENABLE_EVENT_DRIVEN,
    CONF_MOTION_SENSOR_MAPPING,
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
        # Store config_entry as self._config_entry which is the Home Assistant recommended pattern
        self._config_entry = config_entry
        self._motion_sensors = []
        self._cameras = []
        super().__init__()

    async def async_step_init(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Handle options flow."""
        if user_input is not None:
            # Check if user wants to configure motion sensor mapping
            if user_input.get(CONF_ENABLE_EVENT_DRIVEN, False):
                # Store the basic options and proceed to motion sensor mapping
                self._basic_options = user_input
                return await self.async_step_motion_sensors()
            else:
                # Event-driven disabled, save options without mapping
                return self.async_create_entry(title="", data=user_input)

        current_options = self._config_entry.options
        
        options = {
            vol.Optional(
                CONF_SCAN_INTERVAL,
                default=current_options.get(
                    CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL
                ),
            ): vol.All(vol.Coerce(int), vol.Range(min=1, max=60)),
            vol.Optional(
                CONF_STORAGE_PATH,
                default=current_options.get(
                    CONF_STORAGE_PATH, DEFAULT_STORAGE_PATH
                ),
            ): str,
            vol.Optional(
                CONF_SNAPSHOT_FORMAT,
                default=current_options.get(
                    CONF_SNAPSHOT_FORMAT, DEFAULT_SNAPSHOT_FORMAT
                ),
            ): vol.In([
                SNAPSHOT_FORMAT_GIF,
                SNAPSHOT_FORMAT_JPG,
                SNAPSHOT_FORMAT_BOTH
            ]),
            vol.Optional(
                CONF_ENABLE_CACHING,
                default=current_options.get(
                    CONF_ENABLE_CACHING, DEFAULT_ENABLE_CACHING
                ),
            ): bool,
            vol.Optional(
                CONF_RESOLUTION_PREFERENCE,
                default=current_options.get(
                    CONF_RESOLUTION_PREFERENCE, DEFAULT_RESOLUTION_PREFERENCE
                ),
            ): vol.In([
                RESOLUTION_HIGH,
                RESOLUTION_LOW
            ]),
            vol.Optional(
                CONF_ENABLE_EVENT_DRIVEN,
                default=current_options.get(
                    CONF_ENABLE_EVENT_DRIVEN, DEFAULT_ENABLE_EVENT_DRIVEN
                ),
            ): bool,
            vol.Optional(
                CONF_UPLOAD_DELAY,
                default=current_options.get(
                    CONF_UPLOAD_DELAY, DEFAULT_UPLOAD_DELAY
                ),
            ): vol.All(vol.Coerce(int), vol.Range(min=5, max=300)),
            # Media player option removed - always using direct API
        }

        return self.async_show_form(
            step_id="init", 
            data_schema=vol.Schema(options),
            description_placeholders={
                "motion_sensor_info": "If event-driven discovery is enabled, you'll be able to configure motion sensor mappings on the next step."
            }
        )

    async def async_step_motion_sensors(
        self, user_input: Optional[Dict[str, Any]] = None
    ) -> FlowResult:
        """Handle motion sensor mapping configuration."""
        if user_input is not None:
            # Combine basic options with motion sensor mapping
            final_options = {**self._basic_options}
            
            # Build motion sensor mapping from user input
            motion_mapping = {}
            for key, value in user_input.items():
                if key.startswith("sensor_") and value != "none":
                    sensor_id = key.replace("sensor_", "")
                    motion_mapping[sensor_id] = value
            
            if motion_mapping:
                final_options[CONF_MOTION_SENSOR_MAPPING] = motion_mapping
            
            return self.async_create_entry(title="", data=final_options)
        
        # Get available motion sensors and cameras
        await self._get_available_entities()
        
        if not self._motion_sensors:
            # No motion sensors found, skip mapping
            return self.async_create_entry(title="", data=self._basic_options)
        
        # Build schema for motion sensor mapping
        current_mapping = self._config_entry.options.get(CONF_MOTION_SENSOR_MAPPING, {})
        schema_dict = {}
        
        camera_options = ["none"] + [f"{idx}: {name}" for idx, name in self._cameras]
        
        for sensor in self._motion_sensors:
            # Find current mapping for this sensor
            current_camera = "none"
            for mapped_sensor, mapped_camera in current_mapping.items():
                if mapped_sensor == sensor:
                    # Find the camera index for this camera name
                    for idx, name in self._cameras:
                        if name.lower().replace(" ", "_") == mapped_camera:
                            current_camera = f"{idx}: {name}"
                            break
                    break
            
            schema_dict[vol.Optional(f"sensor_{sensor}", default=current_camera)] = vol.In(camera_options)
        
        return self.async_show_form(
            step_id="motion_sensors",
            data_schema=vol.Schema(schema_dict),
            description_placeholders={
                "info": "Map motion sensors to cameras for event-driven recording updates. Select 'none' to disable mapping for a sensor."
            }
        )
    
    async def _get_available_entities(self):
        """Get available motion sensors and cameras."""
        # Get motion sensors
        states = self.hass.states.async_all()
        self._motion_sensors = []
        
        for state in states:
            if (state.entity_id.startswith("binary_sensor.") and 
                (state.attributes.get("device_class") == "motion" or "motion" in state.entity_id.lower())):
                self._motion_sensors.append(state.entity_id)
        
        # Get cameras from coordinator if available
        self._cameras = []
        coordinator_data = self.hass.data.get(DOMAIN, {}).get(self._config_entry.entry_id, {}).get("coordinator")
        if coordinator_data and hasattr(coordinator_data, 'camera_index_map'):
            self._cameras = list(coordinator_data.camera_index_map.items())
        else:
            # Fallback: use some default camera names
            self._cameras = [(0, "Camera 1"), (1, "Camera 2"), (2, "Camera 3"), (3, "Camera 4")]
