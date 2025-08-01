"""Constants for the Reolink Recordings integration."""

DOMAIN = "reolink_recordings"

# Configuration
DEFAULT_SCAN_INTERVAL = 15  # minutes
DEFAULT_STORAGE_PATH = "www/reolink_recordings"
CONF_STORAGE_PATH = "storage_path"
CONF_ENABLE_CACHING = "enable_caching"
DEFAULT_ENABLE_CACHING = True
# Media player configuration completely removed - always using direct Media Source API

# Snapshot format options
CONF_SNAPSHOT_FORMAT = "snapshot_format"
SNAPSHOT_FORMAT_GIF = "gif"
SNAPSHOT_FORMAT_JPG = "jpg"
SNAPSHOT_FORMAT_BOTH = "both"
DEFAULT_SNAPSHOT_FORMAT = SNAPSHOT_FORMAT_GIF

# Resolution preference options
CONF_RESOLUTION_PREFERENCE = "resolution_preference"
RESOLUTION_HIGH = "high"
RESOLUTION_LOW = "low"
DEFAULT_RESOLUTION_PREFERENCE = RESOLUTION_HIGH

# Data keys
DATA_COORDINATOR = "coordinator"

# Services
SERVICE_FETCH_LATEST = "fetch_latest_recordings"
SERVICE_DOWNLOAD_RECORDING = "download_recording"
