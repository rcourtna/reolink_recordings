"""Custom component for managing Reolink camera recordings."""
import os
import logging
import asyncio
from datetime import timedelta
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers import device_registry as dr
from homeassistant.const import (
    CONF_HOST,
    CONF_USERNAME,
    CONF_PASSWORD,
    CONF_SCAN_INTERVAL,
)

from .const import (
    DOMAIN,
    DEFAULT_SCAN_INTERVAL,
    CONF_STORAGE_PATH,
    DEFAULT_STORAGE_PATH,
    DATA_COORDINATOR,
)
from .coordinator import ReolinkRecordingsCoordinator
from .frontend import setup_frontend

_LOGGER = logging.getLogger(__name__)

# Media source is not a regular platform, it's registered separately
PLATFORMS = ["sensor"]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Reolink Recordings from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    # Get configuration
    host = entry.data.get(CONF_HOST)
    username = entry.data.get(CONF_USERNAME)
    password = entry.data.get(CONF_PASSWORD)
    scan_interval = entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
    storage_path = entry.options.get(CONF_STORAGE_PATH, DEFAULT_STORAGE_PATH)

    # Create storage directory if it doesn't exist
    storage_dir = Path(hass.config.path(storage_path))
    os.makedirs(storage_dir, exist_ok=True)

    # Create data coordinator
    coordinator = ReolinkRecordingsCoordinator(
        hass,
        entry.entry_id,
        host,
        username,
        password,
        storage_dir,
        entry=entry,  # Pass the entire config entry for access to options
    )

    # Skip initial data fetch on startup for performance reasons
    # Data will be fetched on first scheduled scan_interval or manual refresh
    # await coordinator.async_refresh()

    # Set up periodic update
    entry.async_on_unload(
        async_track_time_interval(
            hass, coordinator.async_refresh, timedelta(minutes=scan_interval)
        )
    )

    # Store the coordinator
    hass.data[DOMAIN][entry.entry_id] = {
        DATA_COORDINATOR: coordinator,
    }

    # Register the parent/hub device
    device_registry = dr.async_get(hass)
    device_registry.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, entry.entry_id)},
        name="Reolink Recordings Hub",
        manufacturer="Reolink",
        model="Recordings Integration",
        sw_version="1.0",
    )
    
    # Set up all platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register frontend resources
    setup_frontend(hass)
    
    # Register services
    await register_services(hass, entry)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok


async def register_services(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Register services for Reolink Recordings."""
    
    async def handle_refresh(call):
        """Handle the manual refresh service call."""
        entry_id = call.data.get('entry_id', entry.entry_id)
        if entry_id in hass.data[DOMAIN]:
            coordinator = hass.data[DOMAIN][entry_id][DATA_COORDINATOR]
            _LOGGER.info("Manual refresh requested for Reolink Recordings")
            await coordinator.async_refresh()
            _LOGGER.info("Manual refresh completed for Reolink Recordings")
        else:
            _LOGGER.error(f"Entry ID {entry_id} not found for refresh service call")
    
    import voluptuous as vol
    from homeassistant.helpers import config_validation as cv
    
    SERVICE_REFRESH_SCHEMA = vol.Schema({
        vol.Optional('entry_id'): cv.string,
    })
    
    hass.services.async_register(
        DOMAIN, 'refresh', handle_refresh, schema=SERVICE_REFRESH_SCHEMA
    )


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload config entry."""
    await async_unload_entry(hass, entry)
    await async_setup_entry(hass, entry)
