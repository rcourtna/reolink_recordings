"""Data coordinator for Reolink Recordings."""
import os
import logging
import json
import asyncio
import aiohttp
import websockets
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import dt as dt_util

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
    ):
        """Initialize the coordinator."""
        self.hass = hass
        self.entry_id = entry_id
        self.host = host
        self.username = username
        self.password = password
        self.storage_dir = storage_dir
        self.session = async_get_clientsession(hass)
        self.data = {}
        self.recording_paths = {}
        # Map of camera name to snapshot jpg path
        self.snapshot_paths: Dict[str, str] = {}
        self._ws_id = 1
        # Listeners that wish to be notified when new data is available
        self._listeners: list[callable] = []
        
        # Ensure metadata directory exists
        self.metadata_dir = storage_dir / "metadata"
        os.makedirs(self.metadata_dir, exist_ok=True)
        
        # Ensure recordings directory exists
        self.recordings_dir = storage_dir / "recordings"
        os.makedirs(self.recordings_dir, exist_ok=True)

    async def async_refresh(self, *_):
        """Refresh data from Reolink cameras."""
        try:
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
        
        # Use the "media_player.browse_media" service to discover Reolink cameras
        # This is equivalent to the Python script's functionality but using HA's async methods
        entity_id = "media_player.living_room_tv"  # Default entity that can browse media
        
        # Browse the root Reolink media source
        reolink_root = "media-source://reolink"
        root_result = await self._browse_media(entity_id, reolink_root, token)
        
        if "children" not in root_result or not root_result["children"]:
            _LOGGER.warning("No Reolink cameras found")
            return []
        
        # Process each camera
        results = []
        for i, camera in enumerate(root_result["children"]):
            camera_index = i
            camera_name = camera["title"]
            _LOGGER.debug(f"Processing camera: {camera_name} (index: {camera_index})")
            
            try:
                result = await self._get_latest_recording(entity_id, camera_index, camera_name, token)
                results.append(result)
            except Exception as e:
                _LOGGER.error(f"Error processing camera {camera_name}: {str(e)}")
                results.append({
                    "camera": camera_name,
                    "error": str(e)
                })
                
        return results

    async def _get_latest_recording(
        self, entity_id: str, camera_index: int, camera_name: str, token: str
    ) -> Dict[str, Any]:
        """Get the latest recording for a specific camera index."""
        # Step 1: Get camera resolution options
        camera_path = f"media-source://reolink/CAM|01JZW5GP7HJAVQNQXD498N4SKV|{camera_index}"
        camera_result = await self._browse_media(entity_id, camera_path, token, "playlist")
        
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
        res_result = await self._browse_media(entity_id, high_res_option["media_content_id"], token, "playlist")
        
        if "children" not in res_result or not res_result["children"]:
            return {"camera": camera_name, "error": "No dates found"}
        
        # Sort dates in descending order to get the most recent first
        dates = sorted(res_result["children"], key=lambda x: x["title"], reverse=True)
        
        if not dates:
            return {"camera": camera_name, "error": "No dates available"}
        
        latest_date = dates[0]
        
        # Step 4: Get recordings for the latest date
        date_result = await self._browse_media(entity_id, latest_date["media_content_id"], token, "playlist")
        
        if "children" not in date_result or not date_result["children"]:
            return {"camera": camera_name, "date": latest_date["title"], "error": "No recordings found"}
        
        # Sort recordings by title (which contains the timestamp) to get the latest
        recordings = sorted(date_result["children"], key=lambda x: x["title"], reverse=True)
        
        if not recordings:
            return {"camera": camera_name, "date": latest_date["title"], "error": "No recordings available"}
        
        latest_recording = recordings[0]
        
        # Extract timestamp and duration from the title
        # Format is typically: "HH:MM:SS D:DD:DD Type"
        title_parts = latest_recording["title"].split()
        timestamp = title_parts[0] if len(title_parts) > 0 else "Unknown"
        duration = title_parts[1] if len(title_parts) > 1 else "Unknown"
        event_type = " ".join(title_parts[2:]) if len(title_parts) > 2 else "Unknown"
        
        return {
            "camera": camera_name,
            "date": latest_date["title"],
            "timestamp": timestamp,
            "duration": duration,
            "event_type": event_type,
            "media_content_id": latest_recording["media_content_id"],
            "can_play": latest_recording.get("can_play", False)
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
                
            # Create a fixed filename for the latest recording from this camera
            filename = f"{camera_name.replace(' ', '_').lower()}_latest.mp4"
            
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
                self.recording_paths[camera_name] = str(dest_path)

                # Generate a snapshot (first frame) as JPEG for dashboard thumbnails
                try:
                    camera_slug = camera_name.lower().replace(" ", "_")
                    snapshot_path = self.recordings_dir / f"{camera_slug}_latest.jpg"
                    await self._generate_snapshot(dest_path, snapshot_path)
                    if snapshot_path.exists():
                        self.snapshot_paths[camera_name] = str(snapshot_path)
                        _LOGGER.debug(f"Generated snapshot for {camera_name} at {snapshot_path}")
                except Exception as snap_err:
                    _LOGGER.warning(f"Could not generate snapshot for {camera_name}: {snap_err}")

                _LOGGER.info(f"Downloaded recording for {camera_name} to {dest_path}")
                
            except Exception as e:
                _LOGGER.error(f"Error downloading recording for {camera_name}: {e}")

    async def _get_auth_token(self) -> str:
        """Get authentication token from Home Assistant."""
        # For now, we'll assume the long-lived access token is stored in the password field
        # In a production environment, you'd use a more secure method
        return self.password

    async def _browse_media(
        self, entity_id: str, media_content_id: str, token: str, media_content_type: str = "app"
    ) -> Dict[str, Any]:
        """Browse media using the media_player.browse_media service."""
        url = f"{self.host}/api/services/media_player/browse_media?return_response=true"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        data = {
            "entity_id": entity_id,
            "media_content_id": media_content_id,
            "media_content_type": media_content_type
        }
        
        async with self.session.post(url, json=data, headers=headers) as response:
            response.raise_for_status()
            result = await response.json()
            return result["service_response"][entity_id]

    async def _ws_resolve(self, media_id: str, token: str) -> str:
        """Use the WebSocket API to resolve a media_content_id to a proxy URL."""
        ws_url = f"{self.host}/api/websocket".replace("http", "ws", 1)
        
        async with websockets.connect(ws_url) as websocket:
            auth_msg = await websocket.recv()  # hello message
            await websocket.send(json.dumps({"type": "auth", "access_token": token}))
            auth_result = json.loads(await websocket.recv())
            
            if auth_result["type"] != "auth_ok":
                raise RuntimeError("WebSocket authentication failed")
            
            msg_id = self._get_next_ws_id()
            await websocket.send(json.dumps({
                "id": msg_id,
                "type": "media_source/resolve_media",
                "media_content_id": media_id
            }))
            
            response = json.loads(await websocket.recv())
            if response.get("success") is False:
                raise RuntimeError(f"Failed to resolve media: {response.get('error', {}).get('message', 'Unknown error')}")
            
            result = response.get("result", {})
            return f"{self.host}{result.get('url', '')}"

    def _proxy_url(self, media_id: str) -> str:
        """Get the direct proxy URL for a media_content_id."""
        import urllib.parse
        enc = urllib.parse.quote(media_id, safe="")
        return f"{self.host}/api/media_source/proxy/{enc}"

    async def _generate_snapshot(self, video_path: Path, snapshot_path: Path):
        """Generate a JPG snapshot from the first frame of the video using ffmpeg."""
        import subprocess, shlex

        cmd = f"ffmpeg -y -i {shlex.quote(str(video_path))} -frames:v 1 {shlex.quote(str(snapshot_path))}"
        proc = await asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError("ffmpeg failed to generate snapshot")

    async def _download_file(self, url: str, headers: Dict[str, str], dest_path: Path):
        """Download a file from a URL and save it to the destination path."""
        # Ensure the directory exists
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        
        async with self.session.get(url, headers=headers) as response:
            response.raise_for_status()
            
            with open(dest_path, "wb") as f:
                async for chunk in response.content.iter_chunked(CHUNK_SIZE):
                    if chunk:
                        f.write(chunk)
    
    async def _save_metadata(self):
        """Save metadata about the recordings."""
        metadata_file = self.metadata_dir / "recordings.json"
        
        metadata = {
            "last_update": self.data.get("last_update"),
            "recordings": self.recording_paths,
        }
        
        with open(metadata_file, "w") as f:
            json.dump(metadata, f, indent=2)
    
    def _get_next_ws_id(self) -> int:
        """Get the next WebSocket message ID."""
        result = self._ws_id
        self._ws_id += 1
        return result

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
