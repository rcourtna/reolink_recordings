"""Constants for the Reolink Recordings integration."""

DOMAIN = "reolink_recordings"

# Configuration
DEFAULT_SCAN_INTERVAL = 15  # minutes
DEFAULT_STORAGE_PATH = "www/reolink_recordings"
CONF_STORAGE_PATH = "storage_path"

# Data keys
DATA_COORDINATOR = "coordinator"

# Services
SERVICE_FETCH_LATEST = "fetch_latest_recordings"
SERVICE_DOWNLOAD_RECORDING = "download_recording"
