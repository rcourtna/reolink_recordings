"""Media source implementation for Reolink Recordings."""
import logging
import mimetypes
import os
from typing import Tuple

from homeassistant.components.media_player.const import MediaClass, MediaType
# Backwards compatibility for code still using old constant names
MEDIA_CLASS_DIRECTORY = getattr(MediaClass, "DIRECTORY", "directory")
MEDIA_CLASS_VIDEO = getattr(MediaClass, "VIDEO", "video")
MEDIA_TYPE_VIDEO = getattr(MediaType, "VIDEO", "video")
from homeassistant.components.media_source.const import MEDIA_MIME_TYPES
from homeassistant.components.media_source.error import MediaSourceError, Unresolvable
from homeassistant.components.media_source.models import (
    BrowseMediaSource,
    MediaSource,
    MediaSourceItem,
)

# MediaSourceResponse was introduced in HA 2025.4; fall back if older core
try:
    from homeassistant.components.media_source.models import MediaSourceResponse  # type: ignore
except ImportError:  # pragma: no cover
    class MediaSourceResponse:  # minimal shim
        """Fallback response object for older Home Assistant versions."""
        def __init__(self, url: str, mime_type: str | None = None):
            self.url = url
            self.mime_type = mime_type or ""
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN, DATA_COORDINATOR

_LOGGER = logging.getLogger(__name__)


async def async_get_media_source(hass: HomeAssistant) -> MediaSource:
    """Set up Reolink Recordings media source."""
    return ReolinkRecordingsMediaSource(hass)


class ReolinkRecordingsMediaSource(MediaSource):
    """Provide Reolink recordings as media sources."""

    name: str = "Reolink Recordings"

    def __init__(self, hass: HomeAssistant):
        """Initialize Reolink Recordings source."""
        super().__init__(DOMAIN)
        self.hass = hass

    async def async_resolve_media(self, item: MediaSourceItem) -> MediaSourceResponse:
        """Resolve a media item to a URL."""
        if not item.identifier:
            raise Unresolvable("Media item is not a file")

        # Check if we have any instances of this component
        if not self.hass.data.get(DOMAIN):
            raise Unresolvable("No Reolink Recordings instances configured")

        _LOGGER.debug("Resolving media identifier %s", item.identifier)
        # Find the file
        for entry_id, entry_data in self.hass.data[DOMAIN].items():
            coordinator = entry_data[DATA_COORDINATOR]
            # Videos
            for camera_name, recording_path in coordinator.recording_paths.items():
                if os.path.basename(recording_path) == item.identifier:
                    mime_type, _ = mimetypes.guess_type(recording_path)
                    # Return the actual file path for Home Assistant to serve
                    # This is how media_source expects file paths to be returned
                    _LOGGER.debug(f"Resolving {item.identifier} to {recording_path}")
                    return MediaSourceResponse(recording_path, mime_type or "")
                    
            # Snapshots
            if hasattr(coordinator, "snapshot_paths"):
                for camera_name, snapshot_path in coordinator.snapshot_paths.items():
                    if os.path.basename(snapshot_path) == item.identifier:
                        mime_type, _ = mimetypes.guess_type(snapshot_path)
                        # Return the actual file path for Home Assistant to serve
                        _LOGGER.debug(f"Resolving {item.identifier} to {snapshot_path}")
                        return MediaSourceResponse(snapshot_path, mime_type or "")

        raise Unresolvable(f"Could not find file: {item.identifier}")

    async def async_browse_media(self, item: MediaSourceItem) -> BrowseMediaSource:
        """Browse media."""
        if not self.hass.data.get(DOMAIN):
            return BrowseMediaSource(
                domain=DOMAIN,
                identifier="",
                media_class=MEDIA_CLASS_DIRECTORY,
                media_content_type="",
                title=self.name,
                can_play=False,
                can_expand=False,
                children_media_class=MEDIA_CLASS_VIDEO,
                children=[],
            )

        # Root level - show all cameras
        if not item.identifier:
            return await self._async_browse_cameras()

        raise MediaSourceError(f"Unknown identifier: {item.identifier}")

    async def _async_browse_cameras(self) -> BrowseMediaSource:
        """Browse cameras."""
        cameras = {}

        for entry_id, entry_data in self.hass.data[DOMAIN].items():
            coordinator = entry_data[DATA_COORDINATOR]
            for camera_name, recording_path in coordinator.recording_paths.items():
                cameras[camera_name] = recording_path

        media_sources = []
        for camera_name, recording_path in cameras.items():
            filename = os.path.basename(recording_path)
            media_sources.append(
                BrowseMediaSource(
                    domain=DOMAIN,
                    identifier=filename,
                    media_class=MEDIA_CLASS_VIDEO,
                    media_content_type=MEDIA_TYPE_VIDEO,
                    title=camera_name,
                    can_play=True,
                    can_expand=False,
                    thumbnail=None,
                )
            )

        return BrowseMediaSource(
            domain=DOMAIN,
            identifier="",
            media_class=MEDIA_CLASS_DIRECTORY,
            media_content_type="",
            title=self.name,
            can_play=False,
            can_expand=True,
            children_media_class=MEDIA_CLASS_VIDEO,
            children=sorted(media_sources, key=lambda x: x.title),
        )
