"""Dummy media player entity for Reolink Recordings."""
import logging
from typing import Any

from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
)
from homeassistant.const import STATE_IDLE

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    """Set up dummy media player for browsing Reolink media sources."""
    # Add our dummy player
    player = ReolinkDummyMediaPlayer(entry.entry_id)
    async_add_entities([player])
    
    # Store in hass.data for immediate access
    hass.data.setdefault(DOMAIN, {}).setdefault("media_players", {})[entry.entry_id] = player


class ReolinkDummyMediaPlayer(MediaPlayerEntity):
    """Dummy media player that's only used for browsing Reolink media."""

    _attr_should_poll = False
    _attr_has_entity_name = True
    _attr_supported_features = MediaPlayerEntityFeature.BROWSE_MEDIA
    
    def __init__(self, entry_id: str):
        """Initialize the dummy media player."""
        self._attr_unique_id = f"{entry_id}_media_player"
        self._attr_name = "Browser"
        self._entry_id = entry_id
        self.entity_id = "media_player.reolink_recordings_browser"
        
    @property
    def device_info(self):
        """Return device info."""
        return {
            "identifiers": {(DOMAIN, f"{self._entry_id}")},
            # This ensures the media player appears under the same device as other entities
        }
        
    @property
    def state(self):
        """Return the state of the device."""
        return STATE_IDLE
        
    async def async_browse_media(self, media_content_type=None, media_content_id=None):
        """Implement the websocket media browsing helper."""
        # This is just a passthrough entity
        # The actual browse_media implementation happens in the core Home Assistant service
        return None
