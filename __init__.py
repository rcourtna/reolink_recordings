"""Custom component for managing Reolink camera recordings."""
import os
import logging
import asyncio
from datetime import timedelta
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval
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
    )

    # Do initial data fetch
    await coordinator.async_refresh()

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

    
    # Set up all platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register services
    # await register_services(hass)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok


async def async_reload_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload config entry."""
    await async_unload_entry(hass, entry)
    await async_setup_entry(hass, entry)
