"""Frontend code for Reolink Recordings component."""
from __future__ import annotations

import os
import logging
import shutil
import asyncio
import concurrent.futures
from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

# The name of your card JS file
CARD_JS = "reolink-recording-card.js"


def setup_frontend(hass: HomeAssistant) -> None:
    """Set up the reolink recordings frontend."""
    # Get the component directory path
    component_dir = Path(__file__).parent
    component_js_path = component_dir / "frontend" / CARD_JS
    
    # Get the www directory path
    www_dir = Path(hass.config.path("www"))
    www_js_path = www_dir / CARD_JS
    
    # Use a separate thread for file operations to avoid blocking the event loop
    def copy_file_task():
        # Make sure www directory exists
        if not www_dir.exists():
            www_dir.mkdir(parents=True)
        
        # Copy the JS file from the component to www directory if it exists
        if component_js_path.exists():
            try:
                # Check if file already exists and remove it (whether it's a regular file or symlink)
                if www_js_path.exists() or os.path.islink(www_js_path):
                    os.remove(www_js_path)
                
                # Create a symlink instead of copying
                os.symlink(component_js_path, www_js_path)
                _LOGGER.debug(f"Created symlink from {component_js_path} to {www_js_path}")
                return True
            except Exception as e:
                _LOGGER.error(f"Failed to create symlink for {CARD_JS} in www directory: {e}")
                return False
        else:
            _LOGGER.error(f"Card JS file not found at {component_js_path}")
            return False
    
    # Run the blocking operation in a thread pool
    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(copy_file_task)
        if future.result():
            _LOGGER.info(f"Created symlink for {CARD_JS} in www directory")
    
    # Register the URL for the card
    url = f"/local/{CARD_JS}"
    
    # Add it as an extra JS module
    add_extra_js_url(hass, url)
