"""Data coordinator for Reolink Recordings."""
import os
import logging
import json
import asyncio
import aiohttp
import websockets
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional

from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    CONF_STORAGE_PATH,
    DEFAULT_STORAGE_PATH,
    CONF_SNAPSHOT_FORMAT,
    SNAPSHOT_FORMAT_GIF,
    SNAPSHOT_FORMAT_JPG,
    SNAPSHOT_FORMAT_BOTH,
    DEFAULT_SNAPSHOT_FORMAT,
    CONF_ENABLE_CACHING,
    DEFAULT_ENABLE_CACHING,
)

_LOGGER = logging.getLogger(__name__)
CHUNK_SIZE = 4 * 1024 * 1024  # 4 MiB


class ReolinkRecordingsCoordinator:
    """Class to manage fetching Reolink recording data."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry_id: str,
        host: str,
        username: str,
        password: str,
        storage_dir: Path,
        entry: ConfigEntry = None,  # Added to support snapshot format options
    ):
        """Initialize the coordinator."""
        self.hass = hass
        self.entry_id = entry_id
        self.host = host
        self.username = username
        self.password = password
        self.storage_dir = storage_dir
        self.entry = entry  # Store config entry for options access
        self.session = async_get_clientsession(hass)
        self.data = {}
        self.recording_paths = {}
        # Cache to store recording metadata for comparison
        self.recording_cache = {}
        
        # Persistent mapping between camera indices and names
        # This is the key to fixing the camera mixup issue
        self.camera_index_map: Dict[int, str] = {}
        
        # Maps for snapshot paths
        self.snapshot_paths: Dict[str, str] = {}  # GIF paths
        self.jpg_snapshot_paths: Dict[str, str] = {}  # JPG paths
        
        # Get snapshot format preference or use default
        self.snapshot_format = DEFAULT_SNAPSHOT_FORMAT
        if entry and CONF_SNAPSHOT_FORMAT in entry.options:
            self.snapshot_format = entry.options[CONF_SNAPSHOT_FORMAT]
            _LOGGER.debug(f"Using snapshot format: {self.snapshot_format}")
            
        # Media player configuration removed - always using direct Media Source API
        _LOGGER.debug("Using direct Media Source API for Reolink recordings")
        
        # Get caching preference or use default
        self.enable_caching = DEFAULT_ENABLE_CACHING
        if entry and CONF_ENABLE_CACHING in entry.options:
            self.enable_caching = entry.options[CONF_ENABLE_CACHING]
            _LOGGER.debug(f"Caching enabled: {self.enable_caching}")
        
        self._ws_id = 1
        # Listeners that wish to be notified when new data is available
        self._listeners: list[callable] = []
        
        # Ensure metadata directory exists
        self.metadata_dir = storage_dir / "metadata"
        os.makedirs(self.metadata_dir, exist_ok=True)
        
        # Ensure recordings directory exists
        self.recordings_dir = storage_dir / "recordings"
        os.makedirs(self.recordings_dir, exist_ok=True)
        
        # Flag to track if we've loaded cached metadata
        self._metadata_loaded = False

    def _update_config_from_options(self):
        """Update configuration values from entry options."""
        if self.entry and CONF_ENABLE_CACHING in self.entry.options:
            old_value = self.enable_caching
            self.enable_caching = self.entry.options[CONF_ENABLE_CACHING]
            if old_value != self.enable_caching:
                _LOGGER.debug(f"Updated caching setting: {self.enable_caching}")
        
        if self.entry and CONF_SNAPSHOT_FORMAT in self.entry.options:
            old_format = self.snapshot_format
            self.snapshot_format = self.entry.options[CONF_SNAPSHOT_FORMAT]
            if old_format != self.snapshot_format:
                _LOGGER.debug(f"Updated snapshot format: {self.snapshot_format}")
    
    async def async_refresh(self, *_):
        """Refresh data from Reolink cameras."""
        _LOGGER.info("Fetching latest Reolink recordings")
        
        # Update configuration from latest options
        self._update_config_from_options()
        
        try:
            # Load cached metadata on first run
            if not self._metadata_loaded:
                await self._load_cached_metadata()
                self._metadata_loaded = True
            
            _LOGGER.debug("Fetching latest Reolink recordings")
            
            # Discover cameras and their latest recordings
            cameras_data = await self._discover_cameras()
            
            # Download the recordings
            await self._download_recordings(cameras_data)
            
            # Update the data
            self.data = {
                "last_update": dt_util.utcnow().isoformat(),
                "cameras": cameras_data
            }
            
            # TEMPORARY DEBUG: Log detailed data structure for debugging sensor issues
            _LOGGER.warning("========== COORDINATOR DATA DEBUG ==========")
            _LOGGER.warning(f"Complete data structure: {self.data}")
            _LOGGER.warning(f"Recording paths: {self.recording_paths}")
            _LOGGER.warning(f"GIF snapshot paths: {self.snapshot_paths}")
            _LOGGER.warning(f"JPG snapshot paths: {self.jpg_snapshot_paths}")
            
            # Save metadata
            await self._save_metadata()

            # Notify listeners (e.g., sensors) that new data is available
            for update_cb in list(self._listeners):
                try:
                    update_cb()
                except Exception as err:
                    _LOGGER.debug("Listener update failed: %s", err)
            
            _LOGGER.info(f"Refreshed data for {len(cameras_data)} Reolink cameras")
            return True
        
        except Exception as ex:
            _LOGGER.error(f"Error refreshing Reolink recordings: {ex}")
            return False

    async def _discover_cameras(self) -> List[Dict[str, Any]]:
        """Discover all Reolink cameras and their latest recordings."""
        # Get bearer token for API access
        token = await self._get_auth_token()
        
        # Browse the root Reolink media source using direct API
        reolink_root = "media-source://reolink"
        root_result = await self._browse_media(reolink_root, token)
        
        if "children" not in root_result or not root_result["children"]:
            _LOGGER.warning("No Reolink cameras found")
            return []
        
        # Process each camera
        results = []
        
        # Extract camera name to index mapping from media content IDs
        _LOGGER.info(f"Discovering cameras and extracting reliable camera mappings")
        camera_name_to_index = {}
        
        for camera in root_result["children"]:
            camera_name = camera["title"]
            # Extract actual camera index from media_content_id
            # Format is typically: media-source://reolink/CAM|{nvr_id}|{camera_index}
            try:
                # Parse the media_content_id to extract the actual camera index
                content_id_parts = camera["media_content_id"].split("|")
                if len(content_id_parts) >= 3:
                    # The third part should contain the actual camera index
                    actual_camera_index = int(content_id_parts[2])
                    camera_name_to_index[camera_name] = actual_camera_index
                    _LOGGER.info(f"Extracted camera index {actual_camera_index} for camera '{camera_name}' from content ID")
                else:
                    _LOGGER.warning(f"Couldn't parse index from media_content_id: {camera['media_content_id']}")
            except (ValueError, IndexError) as e:
                _LOGGER.warning(f"Error extracting camera index for {camera_name}: {str(e)}")
        
        # Update our persistent camera mapping with the actual indices
        self.camera_index_map.clear()
        for camera_name, camera_index in camera_name_to_index.items():
            self.camera_index_map[camera_index] = camera_name
            
        _LOGGER.info(f"Camera mapping complete: {self.camera_index_map}")
        
        # Process each camera using the correct indices
        for camera in root_result["children"]:
            camera_name = camera["title"]
            camera_index = camera_name_to_index.get(camera_name)
            if camera_index is None:
                _LOGGER.warning(f"No index mapping found for camera: {camera_name}, skipping")
                continue
                
            _LOGGER.debug(f"Processing camera: {camera_name} (index: {camera_index})")
                
            try:
                result = await self._get_latest_recording(camera_index, camera_name, token)
                results.append(result)
            except Exception as e:
                _LOGGER.error(f"Error processing camera {camera_name}: {str(e)}")
                results.append({
                    "camera": camera_name,
                    "error": str(e)
                })
                
        return results

    async def _get_latest_recording(
        self, camera_index: int, camera_name: str, token: str
    ) -> Dict[str, Any]:
        """Get the latest recording for a specific camera index."""
        # Step 1: Get camera resolution options
        # Extract NVR ID from the media_content_id for consistent use
        nvr_id = "01JZW5GP7HJAVQNQXD498N4SKV"  # Default fallback
        try:
            # Get the NVR ID from an existing media content ID if possible
            for child in self.hass.data.get(DOMAIN, {}).get("nvr_entities", []):
                if hasattr(child, "media_content_id") and "|" in child.media_content_id:
                    nvr_id = child.media_content_id.split("|")[1]
                    break
        except Exception as e:
            _LOGGER.debug(f"Couldn't extract NVR ID from existing entities: {e}")
            
        camera_path = f"media-source://reolink/CAM|{nvr_id}|{camera_index}"
        camera_result = await self._browse_media(camera_path, token)
        
        # Step 2: Get the highest resolution option (main)
        if "children" not in camera_result or not camera_result["children"]:
            return {"camera": camera_name, "error": "No resolution options found"}
        
        # Find the highest resolution option (main stream)
        high_res_option = None
        for child in camera_result["children"]:
            if "main" in child["media_content_id"]:
                high_res_option = child
                break
        
        # If main stream not found, try to find any available option
        if not high_res_option and camera_result["children"]:
            high_res_option = camera_result["children"][0]
        
        if not high_res_option:
            return {"camera": camera_name, "error": "No resolution options found"}
        
        # Step 3: Get available dates
        res_result = await self._browse_media(high_res_option["media_content_id"], token)
        
        if "children" not in res_result or not res_result["children"]:
            return {"camera": camera_name, "error": "No dates found"}
        
        # Sort dates in descending order to get the most recent first
        dates = sorted(res_result["children"], key=lambda x: x["title"], reverse=True)
        
        if not dates:
            return {"camera": camera_name, "error": "No dates available"}
        
        latest_date = dates[0]
        
        # Step 4: Get recordings for the latest date
        date_result = await self._browse_media(latest_date["media_content_id"], token)
        
        if "children" not in date_result or not date_result["children"]:
            return {"camera": camera_name, "date": latest_date["title"], "error": "No recordings found"}
        
        # Sort recordings by title (which contains the timestamp) to get the latest
        recordings = sorted(date_result["children"], key=lambda x: x["title"], reverse=True)
        
        if not recordings:
            return {"camera": camera_name, "date": latest_date["title"], "error": "No recordings available"}
        
        latest_recording = recordings[0]
        
        # Extract recording details
        title_parts = latest_recording["title"].split(" ")
        timestamp = title_parts[0] if len(title_parts) > 0 else "Unknown"
        
        # The second part is the duration
        recording_duration = title_parts[1] if len(title_parts) > 1 else "Unknown"
        
        # Check for event type in the remaining parts of the title
        # Format may be like: "17:21:21 0:00:12 Motion Person" or just "17:21:21 0:00:12"
        if len(title_parts) > 2:
            # Join all parts after the timestamp and duration to get the full event type
            event_type = " ".join(title_parts[2:])
        else:
            # If no specific event type found, default to Motion
            event_type = "Motion"  # Default event type
            
        _LOGGER.debug(f"Parsed recording title: '{latest_recording['title']}' → timestamp: '{timestamp}', duration: '{recording_duration}', event_type: '{event_type}'")
        
        
        # Create a unique identifier for this recording
        # This will be used to determine if we already have this recording
        recording_id = f"{camera_index}_{timestamp}_{recording_duration}_{latest_recording.get('duration', 'Unknown')}"
        
        # Return the recording details
        return {
            "camera": camera_name,
            "camera_index": camera_index,  # Include the camera index for consistent mapping
            "date": latest_date["title"],
            "timestamp": timestamp,
            "event_type": event_type,  # Now correctly set to 'Motion' by default
            "duration": recording_duration,  # Now using the value from title_parts[1]
            "media_content_id": latest_recording["media_content_id"],
            "media_content_type": latest_recording["media_content_type"],
            "recording_id": recording_id,  # Add unique identifier
        }

    async def _download_recordings(self, cameras_data: List[Dict[str, Any]]):
        """Download recordings for each camera."""
        token = await self._get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}
        
        for camera_data in cameras_data:
            camera_name = camera_data["camera"]
            
            # Skip if there was an error
            if "error" in camera_data:
                _LOGGER.warning(f"Skipping {camera_name}: {camera_data['error']}")
                continue
            
            # Use the camera_index directly from the camera data
            # This ensures we're using the same index that was used to fetch the recording
            if "camera_index" in camera_data:
                camera_index = camera_data["camera_index"]
                if camera_index in self.camera_index_map:
                    consistent_camera_name = self.camera_index_map[camera_index]
                    _LOGGER.debug(f"Using consistent name '{consistent_camera_name}' for camera '{camera_name}' with index {camera_index}")
                else:
                    consistent_camera_name = camera_name
                    _LOGGER.warning(f"Camera index {camera_index} not found in mapping, using name directly")
            else:
                consistent_camera_name = camera_name
                _LOGGER.warning(f"No camera_index in data for '{camera_name}', using name directly")
            
            # Check if we already have this exact recording
            recording_id = camera_data.get("recording_id")
            cached_recording = self.recording_cache.get(consistent_camera_name)
            
            # Check if we would normally skip this download due to caching
            if recording_id and cached_recording and recording_id == cached_recording["recording_id"]:
                if self.enable_caching:
                    _LOGGER.info(f"Skipping download for {camera_name} - already have the same recording (ID: {recording_id})")
                    
                    # Create a fixed slug for filename consistency
                    camera_slug = consistent_camera_name.lower().replace(" ", "_")
                    
                    # Define expected file paths
                    video_path = self.recordings_dir / f"{camera_slug}_latest.mp4"
                    gif_path = self.recordings_dir / f"{camera_slug}_latest.gif"
                    jpg_path = self.recordings_dir / f"{camera_slug}_latest.jpg"
                    
                    # Update video path if file exists
                    if video_path.exists():
                        _LOGGER.debug(f"Using existing video for {camera_name} at {video_path}")
                        self.recording_paths[camera_name] = str(video_path)
                        self.recording_paths[consistent_camera_name] = str(video_path)
                    
                    # Always check for snapshot files on disk, even when skipping download
                    # This ensures we always have snapshot paths even if they were never added before
                    if gif_path.exists():
                        _LOGGER.debug(f"Using existing GIF snapshot for {camera_name} at {gif_path}")
                        self.snapshot_paths[camera_name] = str(gif_path)
                        self.snapshot_paths[consistent_camera_name] = str(gif_path)
                        
                    if jpg_path.exists():
                        _LOGGER.debug(f"Using existing JPG snapshot for {camera_name} at {jpg_path}")
                        self.jpg_snapshot_paths[camera_name] = str(jpg_path)
                        self.jpg_snapshot_paths[consistent_camera_name] = str(jpg_path)
                            
                    continue
                else:
                    _LOGGER.info(f"Caching disabled - re-downloading recording for {camera_name} (ID: {recording_id})")
                    # Continue with download even though we have the same recording
            
            # Create a fixed filename for the latest recording from this camera
            filename = f"{consistent_camera_name.replace(' ', '_').lower()}_latest.mp4"
            
            # Full path for the recording
            dest_path = self.recordings_dir / filename
            
            # Always overwrite the previous file with the latest recording
            # We'll remove the old file first if it exists to avoid any potential issues
            if dest_path.exists():
                try:
                    os.remove(dest_path)
                    _LOGGER.debug(f"Removed previous recording file: {filename}")
                except Exception as e:
                    _LOGGER.error(f"Error removing old file {dest_path}: {e}")
                    
            _LOGGER.info(f"Downloading recording for camera '{consistent_camera_name}' (index: {camera_data.get('camera_index', 'unknown')}) to {filename}")
            
            # Get the media content ID
            media_id = camera_data["media_content_id"]
            
            try:
                # Try direct proxy method first
                url = self._proxy_url(media_id)
                async with self.session.get(url, headers=headers) as response:
                    if response.status != 200:
                        # Fall back to WebSocket method
                        url = await self._ws_resolve(media_id, token)
                
                # Now download the file
                await self._download_file(url, headers, dest_path)
                
                # Record the video path in our mapping
                # Store using both original and consistent camera names for reliability
                self.recording_paths[camera_name] = str(dest_path)
                if camera_name != consistent_camera_name:
                    self.recording_paths[consistent_camera_name] = str(dest_path)
                    _LOGGER.debug(f"Added additional mapping for consistent camera name '{consistent_camera_name}'")
                
                # Store the recording metadata in our cache
                if recording_id:
                    self.recording_cache[consistent_camera_name] = {
                        "recording_id": recording_id,
                        "timestamp": camera_data.get("timestamp"),
                        "event_type": camera_data.get("event_type"),
                        "duration": camera_data.get("duration"),
                        "path": str(dest_path)
                    }

                # Generate snapshots based on selected format
                try:
                    # Use the consistent camera name for snapshot filenames
                    camera_slug = consistent_camera_name.lower().replace(" ", "_")
                    
                    # Create snapshots based on configured format
                    if self.snapshot_format in [SNAPSHOT_FORMAT_GIF, SNAPSHOT_FORMAT_BOTH]:
                        gif_path = self.recordings_dir / f"{camera_slug}_latest.gif"
                        await self._generate_gif_snapshot(dest_path, gif_path)
                        if gif_path.exists():
                            # Store using original camera name for backward compatibility
                            self.snapshot_paths[camera_name] = str(gif_path)
                            self.snapshot_paths[consistent_camera_name] = str(gif_path)
                            _LOGGER.debug(f"Generated animated GIF for {consistent_camera_name} at {gif_path}")
                    
                    if self.snapshot_format in [SNAPSHOT_FORMAT_JPG, SNAPSHOT_FORMAT_BOTH]:
                        jpg_path = self.recordings_dir / f"{camera_slug}_latest.jpg"
                        await self._generate_jpg_snapshot(dest_path, jpg_path)
                        if jpg_path.exists():
                            # Store using original camera name for backward compatibility
                            self.jpg_snapshot_paths[camera_name] = str(jpg_path)
                            self.jpg_snapshot_paths[consistent_camera_name] = str(jpg_path)
                            _LOGGER.debug(f"Generated JPG snapshot for {consistent_camera_name} at {jpg_path}")
                except Exception as snap_err:
                    _LOGGER.warning(f"Could not generate snapshot(s) for {camera_name}: {snap_err}")

                _LOGGER.info(f"Downloaded recording for {camera_name} to {dest_path}")
                
            except Exception as e:
                _LOGGER.error(f"Error downloading recording for {camera_name}: {e}")

    async def _get_auth_token(self) -> str:
        """Get authentication token from Home Assistant."""
        # For now, we'll assume the long-lived access token is stored in the password field
        # In a production environment, you'd use a more secure method
        return self.password

    async def _browse_media(self, media_content_id: str, token: str) -> Dict[str, Any]:
        """Browse media using direct Media Source API calls.
        
        Args:
            media_content_id: Content ID to browse
            token: Authentication token
            
        Returns:
            Media browse results dictionary
        """
        # Always use direct WebSocket API
        return await self._browse_via_websocket_api(media_content_id, token)
        
    # _browse_via_media_player method removed - always using direct Media Source API
    
    async def _browse_via_websocket_api(self, media_content_id: str, token: str) -> Dict[str, Any]:
        """Browse media using direct WebSocket API calls to the media source."""
        _LOGGER.debug(f"Using direct Media Source API for {media_content_id}")
        
        websocket = None
        try:
            # Get an authenticated websocket connection
            # Properly construct WebSocket URL from host
            if self.host.startswith("http://"):
                websocket_url = f"ws://{self.host[7:]}/api/websocket"
            elif self.host.startswith("https://"):
                websocket_url = f"wss://{self.host[8:]}/api/websocket"
            else:
                websocket_url = f"ws://{self.host}/api/websocket"
                
            _LOGGER.debug(f"Connecting to WebSocket at {websocket_url}")
            websocket = await websockets.connect(websocket_url, ssl=None)
            
            # WebSocket handshake - receive initial auth required message
            auth_required = await websocket.recv()
            auth_required_data = json.loads(auth_required)
            _LOGGER.debug(f"Received auth required message: {auth_required_data}")
            
            if auth_required_data.get("type") != "auth_required":
                raise RuntimeError(f"Unexpected initial message: {auth_required_data}")
                
            # Send authentication message
            auth_msg = {"type": "auth", "access_token": token}
            await websocket.send(json.dumps(auth_msg))
            
            # Get auth result
            auth_resp = await websocket.recv()
            auth_resp_data = json.loads(auth_resp)
            _LOGGER.debug(f"Auth response: {auth_resp_data}")
            
            if auth_resp_data.get("type") != "auth_ok":
                raise RuntimeError("WebSocket authentication failed")
            
            # Send browse request - no media_content_type needed for WebSocket API
            msg_id = self._get_next_ws_id()
            browse_request = {
                "id": msg_id,
                "type": "media_source/browse_media",
                "media_content_id": media_content_id
            }
            await websocket.send(json.dumps(browse_request))
            
            # Process response
            response = await websocket.recv()
            response_data = json.loads(response)
            
            if not response_data.get("success", False):
                error = response_data.get("error", {}).get("message", "Unknown error")
                raise RuntimeError(f"Media Source API error: {error}")
            
            return response_data.get("result", {})
            
        except Exception as e:
            raise RuntimeError(f"WebSocket API error: {str(e)}")
        finally:
            if websocket:
                await websocket.close()

    async def _ws_resolve(self, media_id: str, token: str) -> str:
        """Use the WebSocket API to resolve a media_content_id to a proxy URL."""
        ws_url = f"{self.host}/api/websocket".replace("http", "ws", 1)
        
        _LOGGER.debug(f"WebSocket connecting to {ws_url}")
        
        async with websockets.connect(ws_url) as websocket:
            auth_msg = await websocket.recv()  # hello message
            _LOGGER.debug(f"WebSocket hello message: {auth_msg}")
            
            auth_request = {"type": "auth", "access_token": token}
            _LOGGER.debug(f"WebSocket auth request: {json.dumps(auth_request)}")
            await websocket.send(json.dumps(auth_request))
            
            auth_result = json.loads(await websocket.recv())
            _LOGGER.debug(f"WebSocket auth response: {json.dumps(auth_result)}")
            
            if auth_result["type"] != "auth_ok":
                _LOGGER.error(f"WebSocket authentication failed: {json.dumps(auth_result)}")
                raise RuntimeError("WebSocket authentication failed")
            
            msg_id = self._get_next_ws_id()
            resolve_request = {
                "id": msg_id,
                "type": "media_source/resolve_media",
                "media_content_id": media_id
            }
            _LOGGER.debug(f"WebSocket resolve request: {json.dumps(resolve_request)}")
            await websocket.send(json.dumps(resolve_request))
            
            response = json.loads(await websocket.recv())
            _LOGGER.debug(f"WebSocket resolve response: {json.dumps(response)}")
            
            if response.get("success") is False:
                error_msg = response.get('error', {}).get('message', 'Unknown error')
                _LOGGER.error(f"Failed to resolve media: {error_msg}")
                raise RuntimeError(f"Failed to resolve media: {error_msg}")
            
            result = response.get("result", {})
            resolved_url = f"{self.host}{result.get('url', '')}"
            _LOGGER.debug(f"Resolved media URL: {resolved_url}")
            return resolved_url

    def _proxy_url(self, media_id: str) -> str:
        """Get the direct proxy URL for a media_content_id."""
        import urllib.parse
        enc = urllib.parse.quote(media_id, safe="")
        return f"{self.host}/api/media_source/proxy/{enc}"

    async def _generate_gif_snapshot(self, video_path: Path, snapshot_path: Path):
        """Generate an animated GIF from the video using ffmpeg."""
        import subprocess, shlex

        # Generate animated GIF with reduced settings to improve loading time:
        # - Scale to 320px width (reduced from 640px) for faster loading
        # - Reduced to 1fps (from 2fps) to make files smaller
        # - Still using palette optimization for quality
        # - Limit to first 5 seconds (reduced from 10 seconds) for smaller file size
        cmd = f"ffmpeg -y -t 5 -i {shlex.quote(str(video_path))} -vf \"fps=1,scale=320:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff\" -f image2 /tmp/palette.png && ffmpeg -y -t 5 -i {shlex.quote(str(video_path))} -i /tmp/palette.png -filter_complex \"fps=1,scale=320:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5\" {shlex.quote(str(snapshot_path))}"
        proc = await asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError("ffmpeg failed to generate animated GIF")
    
    async def _generate_jpg_snapshot(self, video_path: Path, snapshot_path: Path):
        """Generate a single JPG snapshot from the video using ffmpeg.
        
        This is a much less CPU-intensive operation than generating an animated GIF.
        """
        import subprocess, shlex
        
        # Generate a single frame JPG snapshot from the beginning of the video
        # Using higher resolution (1024px width) and maximum quality (-q:v 1)
        cmd = f"ffmpeg -y -ss 0 -t 1 -i {shlex.quote(str(video_path))} -vframes 1 -q:v 1 -vf scale=1024:-1 {shlex.quote(str(snapshot_path))}"
        proc = await asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError("ffmpeg failed to generate JPG snapshot")

    async def _download_file(self, url: str, headers: Dict[str, str], dest_path: Path):
        """Download a file from a URL and save it to the destination path."""
        # Ensure the directory exists
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        
        _LOGGER.debug(f"Downloading file from URL: {url}")
        _LOGGER.debug(f"Headers: {headers}")
        _LOGGER.debug(f"Destination path: {dest_path}")
        
        start_time = time.time()
        file_size = 0
        
        try:
            async with self.session.get(url, headers=headers) as response:
                response.raise_for_status()
                _LOGGER.debug(f"Download response status: {response.status}")
                _LOGGER.debug(f"Response headers: {response.headers}")
                
                with open(dest_path, "wb") as f:
                    async for chunk in response.content.iter_chunked(CHUNK_SIZE):
                        if chunk:
                            chunk_size = len(chunk)
                            file_size += chunk_size
                            f.write(chunk)
            
            download_time = time.time() - start_time
            _LOGGER.debug(f"Download completed: {file_size} bytes in {download_time:.2f} seconds ({file_size/download_time/1024:.2f} KB/s)")
        except Exception as e:
            _LOGGER.error(f"Download failed: {str(e)}")
            raise
    
    async def _save_metadata(self):
        """Save metadata about the recordings."""
        metadata_file = self.metadata_dir / "recordings.json"
        
        metadata = {
            "last_update": self.data.get("last_update"),
            "recordings": self.recording_paths,
            "recording_cache": self.recording_cache,  # Save cache for persistence between restarts
        }
        
        try:
            # Use async file operations to avoid blocking warnings
            import aiofiles
            async with aiofiles.open(metadata_file, "w") as f:
                await f.write(json.dumps(metadata, indent=2))
        except ImportError:
            # Fallback to sync operations if aiofiles not available
            with open(metadata_file, "w") as f:
                json.dump(metadata, f, indent=2)
    
    def _get_next_ws_id(self) -> int:
        """Get the next WebSocket message ID."""
        result = self._ws_id
        self._ws_id += 1
        return result
        
    async def _load_cached_metadata(self):
        """Load cached metadata from file if it exists."""
        metadata_file = self.metadata_dir / "recordings.json"
        
        if metadata_file.exists():
            try:
                # Use async file operations to avoid blocking warnings
                import aiofiles
                async with aiofiles.open(metadata_file, "r") as f:
                    content = await f.read()
                    metadata = json.loads(content)
                
                # Restore recording cache if available
                if "recording_cache" in metadata:
                    self.recording_cache = metadata["recording_cache"]
                    _LOGGER.debug(f"Loaded recording cache with {len(self.recording_cache)} entries")
                    
                # Restore recording paths if available
                if "recordings" in metadata:
                    self.recording_paths = metadata["recordings"]
                    _LOGGER.debug(f"Loaded recording paths with {len(self.recording_paths)} entries")
            except ImportError:
                # Fallback to sync operations if aiofiles not available
                try:
                    with open(metadata_file, "r") as f:
                        metadata = json.load(f)
                    
                    if "recording_cache" in metadata:
                        self.recording_cache = metadata["recording_cache"]
                        _LOGGER.debug(f"Loaded recording cache with {len(self.recording_cache)} entries")
                        
                    if "recordings" in metadata:
                        self.recording_paths = metadata["recordings"]
                        _LOGGER.debug(f"Loaded recording paths with {len(self.recording_paths)} entries")
                except Exception as e:
                    _LOGGER.warning(f"Error loading cached metadata: {e}")
            except Exception as e:
                _LOGGER.warning(f"Error loading cached metadata: {e}")
                # Initialize empty cache if loading fails
                self.recording_cache = {}

    # ------------------------------------------------------------------
    # Listener helpers so entities derived from CoordinatorEntity work
    # https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/update_coordinator.py
    # ------------------------------------------------------------------
    def async_add_listener(self, update_callback, context=None):
        """Add a listener that is called whenever new data is available.

        Returns a function to unsubscribe the listener.
        """
        self._listeners.append(update_callback)

        def _unsubscribe():
            if update_callback in self._listeners:
                self._listeners.remove(update_callback)

        return _unsubscribe

    async def async_request_refresh(self):
        """Request an immediate data refresh."""
        await self.async_refresh()
    
    # _get_available_media_player method removed - always using direct Media Source API
