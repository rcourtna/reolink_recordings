"""Sensor platform for Reolink Recordings."""
import os
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN, DATA_COORDINATOR
from .coordinator import ReolinkRecordingsCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Reolink Recording sensors."""
    coordinator = hass.data[DOMAIN][config_entry.entry_id][DATA_COORDINATOR]

    # Make sure we have fresh data before building sensors
    await coordinator.async_request_refresh()

    entities = []
    # Add a sensor for each camera once data is available
    if coordinator.data and "cameras" in coordinator.data:
        for camera_data in coordinator.data["cameras"]:
            camera_name = camera_data["camera"]
            if "error" not in camera_data:
                entities.append(
                    ReolinkRecordingSensor(
                        coordinator,
                        camera_name,
                        config_entry.entry_id,
                    )
                )
    
    async_add_entities(entities)


class ReolinkRecordingSensor(CoordinatorEntity, SensorEntity):
    """Sensor representing a Reolink camera recording."""

    def __init__(
        self,
        coordinator: ReolinkRecordingsCoordinator,
        camera_name: str,
        config_entry_id: str,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self.camera_name = camera_name
        self._config_entry_id = config_entry_id
        self._camera_slug = camera_name.lower().replace(' ', '_')
        
        # Entity properties
        self._attr_name = f"{camera_name} Latest Recording"
        self._attr_unique_id = f"{DOMAIN}_{config_entry_id}_{self._camera_slug}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{config_entry_id}_{self._camera_slug}")},
            name=camera_name,
            manufacturer="Reolink",
            model="Camera",
            via_device=(DOMAIN, config_entry_id),
        )
        self._attr_icon = "mdi:video"
        
        # Fixed filenames for latest assets
        self._video_filename = f"{self._camera_slug}_latest.mp4"
        self._snapshot_filename = f"{self._camera_slug}_latest.jpg"
    
    @property
    def available(self) -> bool:
        """Always available if we have a path for the latest recording."""
        return self.camera_name in self.coordinator.recording_paths
    
    @property
    def state(self) -> Optional[str]:
        """Return the state of the sensor."""
        # Find this camera's data
        for camera_data in self.coordinator.data.get("cameras", []):
            if camera_data["camera"] == self.camera_name:
                if "error" in camera_data:
                    return None
                    
                # Return timestamp and event type as state
                timestamp = camera_data.get("timestamp", "Unknown")
                date = camera_data.get("date", "Unknown")
                event_type = camera_data.get("event_type", "Unknown")
                return f"{date} {timestamp} - {event_type}"
                
        return None
    
    @property
    def extra_state_attributes(self) -> Dict[str, Any]:
        """Return entity specific state attributes."""
        attributes = {}
        now = datetime.now()
        timestamp = now.strftime("%s")  # Unix timestamp for cache busting
        
        # Find this camera's data and recording path
        for camera_data in self.coordinator.data.get("cameras", []):
            if camera_data["camera"] == self.camera_name:
                if "error" not in camera_data:
                    attributes["date"] = camera_data.get("date")
                    attributes["timestamp"] = camera_data.get("timestamp")
                    attributes["duration"] = camera_data.get("duration")
                    attributes["event_type"] = camera_data.get("event_type")
                    attributes["last_updated"] = now.isoformat()
                    
                    # Get the file path
                    recording_path = self.coordinator.recording_paths.get(self.camera_name)
                    if recording_path:
                        attributes["file_path"] = recording_path
                        attributes["file_name"] = self._video_filename

                        # Media URL (MP4) for tap-to-play - using /local/ URL via symlink
                        attributes["media_url"] = f"/local/reolink_recordings/recordings/{self._video_filename}?t={timestamp}"

                        # Prefer snapshot image for entity_picture if generated
                        snapshot_path = getattr(self.coordinator, "snapshot_paths", {}).get(self.camera_name)
                        if snapshot_path:
                            picture_url = f"/local/reolink_recordings/recordings/{self._snapshot_filename}?t={timestamp}"
                            attributes["entity_picture"] = picture_url
                            self._attr_entity_picture = picture_url
                        else:
                            # Fallback to using the mp4 (may not render in picture card)
                            picture_url = f"/media-source/{DOMAIN}/{self._video_filename}?t={timestamp}"
                            attributes["entity_picture"] = picture_url
                            self._attr_entity_picture = picture_url
                        
        return attributes
