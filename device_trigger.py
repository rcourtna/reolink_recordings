"""Device trigger support for Reolink Recordings."""
from __future__ import annotations

import voluptuous as vol
from typing import Any

from homeassistant.components.device_automation import DEVICE_TRIGGER_BASE_SCHEMA
from homeassistant.components.homeassistant.triggers import event as event_trigger
from homeassistant.const import CONF_DEVICE_ID, CONF_DOMAIN, CONF_PLATFORM, CONF_TYPE
from homeassistant.core import CALLBACK_TYPE, HomeAssistant
from homeassistant.helpers import config_validation as cv, device_registry as dr
from homeassistant.helpers.trigger import TriggerActionType, TriggerInfo
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN, EVENT_RECORDING_UPDATED

# Trigger types
TRIGGER_RECORDING_UPDATED = "recording_updated"
TRIGGER_VEHICLE_DETECTED = "vehicle_detected"
TRIGGER_PERSON_DETECTED = "person_detected"
TRIGGER_MOTION_DETECTED = "motion_detected"

TRIGGER_TYPES = {
    TRIGGER_RECORDING_UPDATED,
    TRIGGER_VEHICLE_DETECTED,
    TRIGGER_PERSON_DETECTED,
    TRIGGER_MOTION_DETECTED,
}

TRIGGER_SCHEMA = DEVICE_TRIGGER_BASE_SCHEMA.extend(
    {
        vol.Required(CONF_TYPE): vol.In(TRIGGER_TYPES),
    }
)


async def async_get_triggers(
    hass: HomeAssistant, device_id: str
) -> list[dict[str, Any]]:
    """List device triggers for Reolink Recordings devices."""
    device_registry = dr.async_get(hass)
    device = device_registry.async_get(device_id)
    
    if not device or device.config_entries is None:
        return []
    
    # Check if this device belongs to our domain
    config_entries = [
        entry_id for entry_id in device.config_entries
        if entry_id in hass.data.get(DOMAIN, {})
    ]
    
    if not config_entries:
        return []
    
    # Get camera name from device identifiers
    camera_name = None
    for identifier in device.identifiers:
        if identifier[0] == DOMAIN and len(identifier) > 1:
            # Format: (DOMAIN, f"{entry_id}_{camera_name}")
            parts = identifier[1].split("_", 1)
            if len(parts) > 1:
                camera_name = parts[1]
                break
    
    if not camera_name:
        return []
    
    # Return available triggers for this camera
    triggers = []
    for trigger_type in TRIGGER_TYPES:
        triggers.append({
            CONF_PLATFORM: "device",
            CONF_DEVICE_ID: device_id,
            CONF_DOMAIN: DOMAIN,
            CONF_TYPE: trigger_type,
        })
    
    return triggers


async def async_attach_trigger(
    hass: HomeAssistant,
    config: ConfigType,
    action: TriggerActionType,
    trigger_info: TriggerInfo,
) -> CALLBACK_TYPE:
    """Attach a trigger."""
    device_registry = dr.async_get(hass)
    device = device_registry.async_get(config[CONF_DEVICE_ID])
    
    if not device:
        return lambda: None
    
    # Get camera name from device identifiers
    camera_name = None
    for identifier in device.identifiers:
        if identifier[0] == DOMAIN and len(identifier) > 1:
            parts = identifier[1].split("_", 1)
            if len(parts) > 1:
                camera_name = parts[1]
                break
    
    if not camera_name:
        return lambda: None
    
    trigger_type = config[CONF_TYPE]
    
    # Create event trigger configuration
    event_config = event_trigger.TRIGGER_SCHEMA({
        event_trigger.CONF_PLATFORM: "event",
        event_trigger.CONF_EVENT_TYPE: EVENT_RECORDING_UPDATED,
    })
    
    # Attach the event trigger
    event_unsub = await event_trigger.async_attach_trigger(
        hass, event_config, _create_filtered_action(action, camera_name, trigger_type), trigger_info
    )
    
    return event_unsub


def _create_filtered_action(action: TriggerActionType, camera_name: str, trigger_type: str) -> TriggerActionType:
    """Create a filtered action that only triggers for the specific camera and event type."""
    
    async def filtered_action(run_variables: dict[str, Any], context=None) -> None:
        """Filter events and execute action if conditions match."""
        import logging
        _LOGGER = logging.getLogger(__name__)
        
        # Extract event data from the trigger structure
        if "trigger" not in run_variables:
            return
            
        trigger_data = run_variables["trigger"]
        if not isinstance(trigger_data, dict) or 'event' not in trigger_data:
            return
            
        event = trigger_data['event']
        event_type = getattr(event, 'event_type', None)
        event_data = getattr(event, 'data', {})
        
        # Debug logging for camera name matching
        event_camera = event_data.get("camera") if isinstance(event_data, dict) else None
        _LOGGER.debug(f"Device trigger filter: Event type='{event_type}', Expected camera='{camera_name}', Event camera='{event_camera}'")
        
        # Only process our specific event type
        if event_type != EVENT_RECORDING_UPDATED:
            _LOGGER.debug(f"Ignoring event type '{event_type}' - not our recording event")
            return
        
        # Skip if no camera data (incomplete event)
        if not event_camera:
            _LOGGER.debug(f"Skipping event with no camera data")
            return
        
        # Check if this event is for our camera (normalize names for comparison)
        # Device identifiers use underscores, events use spaces
        normalized_event_camera = event_camera.replace(" ", "_").lower()
        normalized_camera_name = camera_name.replace(" ", "_").lower()
        
        if normalized_event_camera != normalized_camera_name:
            _LOGGER.debug(f"Camera name mismatch: '{event_camera}' (normalized: '{normalized_event_camera}') != '{camera_name}' (normalized: '{normalized_camera_name}') - skipping trigger")
            return
        
        _LOGGER.debug(f"Camera match found! Executing action for {camera_name} trigger")
        
        # Filter by trigger type
        event_type = event_data.get("event_type", "").lower()
        
        if trigger_type == TRIGGER_RECORDING_UPDATED:
            # Any recording update triggers this
            pass
        elif trigger_type == TRIGGER_VEHICLE_DETECTED:
            if "vehicle" not in event_type:
                return
        elif trigger_type == TRIGGER_PERSON_DETECTED:
            if "person" not in event_type:
                return
        elif trigger_type == TRIGGER_MOTION_DETECTED:
            # Motion events that are not vehicle or person
            if "vehicle" in event_type or "person" in event_type:
                return
            if "motion" not in event_type:
                return
        else:
            return
        
        # Execute the original action
        await action(run_variables, context)
    
    return filtered_action
