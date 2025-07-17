"""Frontend code for Reolink Recordings component."""
from __future__ import annotations

import os
import logging
import shutil
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
    
    # Make sure www directory exists
    if not www_dir.exists():
        www_dir.mkdir(parents=True)
    
    # Copy the JS file from the component to www directory if it exists
    if component_js_path.exists():
        try:
            shutil.copy2(component_js_path, www_js_path)
            _LOGGER.info(f"Copied {CARD_JS} to www directory")
        except Exception as e:
            _LOGGER.error(f"Failed to copy {CARD_JS} to www directory: {e}")
            return
    else:
        _LOGGER.error(f"Card JS file not found at {component_js_path}")
        return
    
    # Register the URL for the card
    url = f"/local/{CARD_JS}"
    
    # Add it as an extra JS module
    add_extra_js_url(hass, url)
