# Reolink Recordings for Home Assistant

A custom component that fetches and downloads the latest recordings from your Reolink cameras, making them available as media sources in Home Assistant dashboards.

## Features

- Automatically discovers and downloads the latest recordings from all your Reolink cameras
- Makes recordings available via `/local/` URLs for reliable access
- Creates sensors with attributes containing recording details
- Detects specific event types (Motion, Person, Vehicle, Animal) from recording metadata
- Uses fixed filenames for latest recordings to simplify dashboard usage
- Enables auto-refreshing images on your dashboard
- Provides tap-to-expand functionality for quick viewing
- Generates high-quality animated GIF previews (640px width) and JPG snapshots (1024px width)
- Intelligent caching system to avoid redundant downloads of identical recordings
- Prepares downloaded recordings for future AI processing
- Periodic update of recordings (configurable interval)

## Installation

### Manual Installation
1. Download the repository as a ZIP file and extract it
2. Copy the `reolink_recordings` folder to your Home Assistant `custom_components` directory
3. Restart Home Assistant

> **Note:** HACS installation is not yet available for this component. It will be added in a future release.

## Configuration

### Through the UI
1. Go to Settings → Devices & Services
2. Click "+ Add Integration" button at the bottom right
3. Search for "Reolink Recordings" (after installing the component and restarting Home Assistant, it will appear in the integration list)
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
- Snapshot Format: Choose between animated GIF, static JPG, or both for snapshots
- Enable Caching: Toggle the caching system on/off (useful to disable during development/debugging)
- Resolution Preference: Choose between high-resolution (default) or low-resolution streams when browsing recordings

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

#### Method 2: Using Picture Card with Auto-Refresh

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

#### Method 4: Using the Custom Reolink Recording Card (Recommended)

A custom Lovelace card has been created specifically for this integration and provides the best experience:

1. Copy the `reolink-recording-card.js` file to your `www` directory
2. Add it as a resource in your Lovelace configuration:
   - Go to Settings → Dashboards → Resources
   - Add `/local/reolink-recording-card.js` as a JavaScript module
3. Add the card to your dashboard:

```yaml
type: custom:reolink-recording-card
entity: sensor.first_landing_latest_recording
title: First Landing
refresh_interval: 60
show_title: true
show_state: true
use_jpg: true
tap_action:
  action: url
```

Features:
- Auto-refreshes camera snapshots with configurable interval
- Built-in cache-busting to ensure fresh images (URLs already include timestamp parameters)
- Configurable to use JPG images instead of GIFs for better performance
- Clickable to open MP4 video in new tab
- Shows camera state information and recording details
- Customizable tap action

### Services

The integration provides these services:

#### reolink_recordings.fetch_latest_recordings
Manually triggers a refresh of all camera recordings.

#### reolink_recordings.download_recording
Downloads a recording from a specific camera.

Parameters:
- `camera_name`: Name of the camera
- `entity_id`: Optional, the entity ID of this integration

## Sensor Data and Attributes

Each camera creates a sensor entity with the format `sensor.camera_name_latest_recording` that provides useful data:

### Sensor State
The sensor state combines the recording date, timestamp, and event type in a format like:
```
2025/7/20 17:21:21 - Motion Person
```

### Available Attributes
Each sensor has these attributes:
- `date`: The recording date (e.g., "2025/7/20")
- `timestamp`: The recording time (e.g., "17:21:21")
- `duration`: The recording duration (e.g., "0:00:12")
- `event_type`: The detected event type (e.g., "Motion", "Motion Person", "Vehicle", "Animal")
- `file_path`: Full path to the recording file
- `file_name`: Name of the recording file
- `media_url`: URL to access the media with cache-busting parameter
- `entity_picture`: URL to the snapshot image (GIF or JPG based on configuration)
- `jpg_picture`: URL to the JPG snapshot (when using both GIF and JPG format)

These attributes can be used in automations, templates, and dashboard cards.

## Viewing Recordings

All recordings are stored in the `www/reolink_recordings/recordings` directory and can be accessed via `/local/reolink_recordings/recordings/` URLs. Each camera has fixed filenames for the latest recording (`camera_name_latest.mp4`), animated preview (`camera_name_latest.gif`), and snapshot (`camera_name_latest.jpg`) for easy reference in dashboards.

## Performance Optimizations

### Caching System
The integration includes an intelligent caching system that avoids redundant downloads of identical recordings. Each recording is assigned a unique ID based on camera index, timestamp, event type, and duration. When a recording with the same ID is detected, the download is skipped, reducing network traffic and CPU usage.

You can disable caching in the integration options when debugging or developing new features.
