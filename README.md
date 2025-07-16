# Reolink Recordings for Home Assistant

A custom component that fetches and downloads the latest recordings from your Reolink cameras, making them available as media sources in Home Assistant dashboards.

## Features

- Automatically discovers and downloads the latest recordings from all your Reolink cameras
- Makes recordings available via `/local/` URLs for reliable access
- Creates sensors with attributes containing recording details
- Uses fixed filenames for latest recordings to simplify dashboard usage
- Enables auto-refreshing images on your dashboard
- Provides tap-to-expand functionality for quick viewing
- Prepares downloaded recordings for future AI processing
- Periodic update of recordings (configurable interval)

## Installation

### HACS Installation (Recommended)
1. Make sure [HACS](https://hacs.xyz/) is installed in your Home Assistant instance
2. Go to HACS → Integrations → Add Integration
3. Search for "Reolink Recordings" and install it
4. Restart Home Assistant

### Manual Installation
1. Copy the `reolink_recordings` folder to your Home Assistant `custom_components` directory
2. Restart Home Assistant

## Configuration

### Through the UI
1. Go to Settings → Devices & Services
2. Click "+ Add Integration" button at the bottom right
3. Search for "Reolink Recordings"
4. Follow the configuration steps:
   - Name: A name for this integration
   - Host: Your Home Assistant URL (default: http://localhost:8123)
   - Username: Your Home Assistant username (not used yet)
   - Password: Your Home Assistant Long-Lived Access Token
     - Create one at your profile page → Long-Lived Access Tokens

### Configuration Options
After setup, you can adjust these options:
- Scan Interval: How often to check for new recordings (in minutes)
- Storage Path: Where to store downloaded recordings (should be set to `www/reolink_recordings` for proper functionality)

## Usage

### Adding recordings to your dashboard

#### Method 1: Using the Picture Entity card (auto-refreshing)
This method will show the latest recording frame and auto-refresh it.

1. Go to your dashboard
2. Add a new card → Picture Entity
3. Configure with these settings:

```yaml
type: picture-entity
entity: sensor.camera_name_latest_recording
camera_view: auto
show_state: true
show_name: true
tap_action:
  action: url
  url_path: /local/reolink_recordings/recordings/camera_name_latest.mp4
```

Replace:
- `camera_name` with your camera's name (as it appears in the sensor name)

#### Method 2: Using Picture Card with Auto-Refresh (Recommended)

This method displays an auto-refreshing snapshot from the latest recording with a tap-to-expand functionality:

```yaml
type: picture
image: /api/sensor/sensor.front_door_latest_recording/attribute/entity_picture
refresh_interval: 60
tap_action:
  action: fire-dom-event
  browser_mod:
    service: browser_mod.popup
    data:
      content:
        type: picture
        image: /api/sensor/sensor.front_door_latest_recording/attribute/entity_picture
        tap_action:
          action: none
      title: Front Door Camera
      size: wide
      autoclose: false
```

Replace `front_door` with your camera's name (as it appears in the sensor name).

This method:
- Auto-refreshes every 60 seconds
- Shows the latest recording frame
- Pops up a larger view when tapped
- Requires the [browser_mod](https://github.com/thomasloven/hass-browser_mod) integration

#### Method 3: Alternative Picture Card (No browser_mod needed)

```yaml
type: picture
image: /api/sensor/sensor.front_door_latest_recording/attribute/entity_picture
refresh_interval: 60
tap_action:
  action: url
  url_path: /api/sensor/sensor.front_door_latest_recording/attribute/media_url
```

This will open the recording in your browser when tapped.

### Services

The integration provides these services:

#### reolink_recordings.fetch_latest_recordings
Manually triggers a refresh of all camera recordings.

#### reolink_recordings.download_recording
Downloads a recording from a specific camera.

Parameters:
- `camera_name`: Name of the camera
- `entity_id`: Optional, the entity ID of this integration

## Viewing Recordings

All recordings are stored in the `www/reolink_recordings/recordings` directory and can be accessed via `/local/reolink_recordings/recordings/` URLs. Each camera has fixed filenames for the latest recording (`camera_name_latest.mp4`) and snapshot (`camera_name_latest.jpg`) for easy reference in dashboards.
