/**
 * Reolink Recording Card for Home Assistant
 * v1.1.2
 * A simple card to display Reolink camera recordings with auto-refresh
 */
class ReolinkRecordingCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('reolink-recording-card-editor');
  }

  static getStubConfig() {
    return {
      entity: '',
      title: '',
      refresh_interval: 60,
      show_title: true,
      show_state: true,
      use_jpg: false,
      tap_action: { action: 'url' }
    };
  }
  
  // Support for Section View layout
  static getGridOptions() {
    return {
      min_cols: 2,
      suggested_cols: 2,
      min_rows: 2,
      suggested_rows: 2
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this.refreshInterval = null;
    this.isLoading = false;
    this.loadError = false;
    this.cardRendered = false;
  }

  setConfig(config) {
    if (!config) {
      console.warn('Reolink Recording Card: No configuration provided, using defaults');
      this._config = ReolinkRecordingCard.getStubConfig();
      return;
    }
    
    this._config = {
      ...ReolinkRecordingCard.getStubConfig(),
      ...config
    };
  }

  getCardSize() {
    return 3;
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  disconnectedCallback() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    
    // Clean up visibility change listener
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  render() {
    try {
      if (!this._hass || !this._config) {
        console.log('Reolink Card: Waiting for hass or config to be available');
        return;
      }

      if (!this._config.entity) {
        console.warn('Reolink Card: No entity configured');
        this.renderError('Please define an entity');
        return;
      }

      const entity = this._hass.states[this._config.entity];
      if (!entity) {
        console.warn(`Reolink Card: Entity not found: ${this._config.entity}`);
        this.renderError(`Entity not found: ${this._config.entity}`);
        return;
      }

      const attributes = entity.attributes || {};
      console.log(`Reolink Card: Rendering ${this._config.entity}`, { attributes });
      
      const entityName = entity.entity_id.split('.')[1].replace(/_/g, ' ');
      const friendlyName = attributes.friendly_name || entityName;
      const title = this._config.title || friendlyName;
    
    const showState = this._config.show_state !== false;
    
    // Parse timestamp from attributes if available
    let existingTimestamp = '';
    if (attributes.entity_picture && attributes.entity_picture.includes('t=')) {
      const matches = attributes.entity_picture.match(/[?&]t=([^&]+)/);
      if (matches) {
        existingTimestamp = matches[1];
      }
    }
    
    // Choose between GIF and JPG based on configuration
    let imageUrl = null;
    let videoUrl = null;
    
    // Only generate image URLs on first render or when refreshing
    if (!this.cardRendered || this.isLoading) {
      // Use existing timestamp if available, otherwise generate one
      const cacheBuster = existingTimestamp || `t=${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      
      if (this._config.use_jpg && attributes.jpg_picture) {
        // Use JPG if configured and available
        const baseUrl = attributes.jpg_picture;
        imageUrl = baseUrl.includes('?') ? `${baseUrl}&${cacheBuster}` : `${baseUrl}?${cacheBuster}`;
      } else if (attributes.entity_picture) {
        // Otherwise use default entity_picture (usually GIF)
        const baseUrl = attributes.entity_picture;
        imageUrl = baseUrl.includes('?') ? `${baseUrl}&${cacheBuster}` : `${baseUrl}?${cacheBuster}`;
      }
      
      // Apply the same cache busting approach to video URL
      if (attributes.media_url) {
        const baseUrl = attributes.media_url;
        videoUrl = baseUrl.includes('?') ? `${baseUrl}&${cacheBuster}` : `${baseUrl}?${cacheBuster}`;
      }
    }

    // Only render the card structure once unless the entity changes
    if (!this.cardRendered) {
      console.log(`Reolink Card - Initial render for ${title}`);
      this.shadowRoot.innerHTML = `
        <style>
          ha-card {
            overflow: hidden;
            padding: 0;
            border: none;
            background: transparent;
            box-shadow: none;
          }
          
          .state-info-overlay {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 70%, rgba(0,0,0,0) 100%);
            color: white;
            padding: 10px 12px;
            font-size: 0.9em;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.7);
            z-index: 5;
            display: flex;
            justify-content: space-between;
          }
          .bottom-left {
            font-weight: 500;
            text-align: left;
          }
          .bottom-right {
            font-weight: 400;
            text-align: right;
          }
          .image-container {
            position: relative;
            width: 100%;
            cursor: pointer;
            min-height: 150px;
          }
          .reolink-image {
            width: 100%;
            display: block;
          }
          .play-icon {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            opacity: 0;
            background-color: rgba(0, 0, 0, 0.6);
            border-radius: 50%;
            width: 60px;
            height: 60px;
            display: flex;
            justify-content: center;
            align-items: center;
            transition: opacity 0.3s;
          }
          .image-container:hover .play-icon {
            opacity: 1;
          }
          .play-icon svg {
            width: 36px;
            height: 36px;
            fill: white;
          }
          .loading-container {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            background-color: var(--secondary-background-color);
            opacity: 0.8;
          }
          .loading-spinner {
            border: 4px solid rgba(0, 0, 0, 0.1);
            border-radius: 50%;
            border-top: 4px solid var(--primary-color);
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .error-container {
            background-color: var(--secondary-background-color);
            color: var(--error-color);
            height: 150px;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 16px;
            text-align: center;
          }
          .no-image {
            background-color: var(--secondary-background-color);
            color: var(--secondary-text-color);
            height: 150px;
            display: flex;
            justify-content: center;
            align-items: center;
          }
        </style>

        <ha-card>
          <div class="image-container">
            ${imageUrl ? `
              <!-- Using loading="lazy" attribute for image lazy loading -->
              <img 
                class="reolink-image" 
                src="${imageUrl}" 
                alt="${title}" 
                loading="lazy"
                @load="${this.onImageLoaded.bind(this)}" 
                @error="${this.onImageError.bind(this)}" />
              
              <!-- Overlaid state info at bottom -->
              ${showState ? `
                <div class="state-info-overlay">
                  <div class="bottom-left">${title}: ${attributes.event_type || 'Motion'}</div>
                  <div class="bottom-right">${attributes.timestamp || ''}</div>
                </div>
              ` : ''}
              
              <div class="play-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
                </svg>
              </div>
              
              <div class="loading-container" id="loading-spinner">
                <div class="loading-spinner"></div>
              </div>
            ` : `
              <div class="no-image">No image available</div>
            `}
            
            <div id="error-message" class="error-container" style="display: none;">
              Failed to load image
            </div>
          </div>
        </ha-card>
      `;
      
      // Flag that we've rendered the card structure
      this.cardRendered = true;
      
      // Add event listeners for image loading
      const img = this.shadowRoot.querySelector('.reolink-image');
      if (img) {
        img.addEventListener('load', this.onImageLoaded.bind(this));
        img.addEventListener('error', this.onImageError.bind(this));
      }
      
      // Add click handler
      if (videoUrl) {
        const card = this.shadowRoot.querySelector('.image-container');
        if (card) {
          card.addEventListener('click', () => {
            this.handleTap(videoUrl);
          });
        }
      }
      
      // Set up auto-refresh
      this.setupAutoRefresh();
    } else {
      // If card is already rendered, only update the image URL and state info
      this.updateImageSource(imageUrl, videoUrl, attributes, title, showState);
    }
    } catch (error) {
      console.error('Reolink Card: Render error that would cause "Configuration error":', error);
      console.error('Reolink Card: Stack trace:', error.stack);
      console.error('Reolink Card: Entity:', this._config?.entity);
      console.error('Reolink Card: Config:', this._config);
      
      // Render a helpful error message instead of letting Home Assistant show "Configuration error"
      this.renderError(`Render failed: ${error.message}. Check console for details.`);
    }
  }

  updateImageSource(imageUrl, videoUrl, attributes, title, showState) {
    try {
      // Only update if we have new image URL
      if (!imageUrl) {
        console.log('Reolink Card: No image URL provided for update');
        return;
      }
      
      // Show loading spinner
      this.isLoading = true;
      const loadingSpinner = this.shadowRoot?.querySelector('#loading-spinner');
      if (loadingSpinner) loadingSpinner.style.display = 'flex';
      
      // Hide error message if previously shown
      const errorMessage = this.shadowRoot?.querySelector('#error-message');
      if (errorMessage) errorMessage.style.display = 'none';
      
      // Update image source
      const img = this.shadowRoot?.querySelector('.reolink-image');
      if (img) {
        console.log(`Reolink Card: Updating image source for ${title}`);
        img.src = imageUrl;
      } else {
        console.warn('Reolink Card: Could not find image element to update');
      }
      
      // Update state info if needed
      if (showState && attributes) {
        const titleEl = this.shadowRoot?.querySelector('.bottom-left');
        const timestampEl = this.shadowRoot?.querySelector('.bottom-right');
        
        if (titleEl) titleEl.textContent = `${title}: ${attributes.event_type || 'Motion'}`;
        if (timestampEl) timestampEl.textContent = attributes.timestamp || '';
      }
      
      // Update video URL for tap action if available
      if (videoUrl) {
        const card = this.shadowRoot?.querySelector('.image-container');
        if (card) {
          const oldHandler = card.onclick;
          card.onclick = () => this.handleTap(videoUrl);
        }
      }
    } catch (error) {
      console.error('Reolink Card: Error updating image source:', error);
      console.error('Reolink Card: This could cause "Configuration error" in UI');
      this.isLoading = false;
      this.loadError = true;
    }
  }

  onImageLoaded() {
    console.log('Image loaded successfully');
    this.isLoading = false;
    this.loadError = false;
    
    // Hide loading spinner
    const loadingSpinner = this.shadowRoot.querySelector('#loading-spinner');
    if (loadingSpinner) loadingSpinner.style.display = 'none';
  }

  onImageError() {
    console.error('Failed to load image');
    this.isLoading = false;
    this.loadError = true;
    
    // Hide loading spinner
    const loadingSpinner = this.shadowRoot.querySelector('#loading-spinner');
    if (loadingSpinner) loadingSpinner.style.display = 'none';
    
    // Show error message
    const errorMessage = this.shadowRoot.querySelector('#error-message');
    if (errorMessage) errorMessage.style.display = 'flex';
  }

  renderError(message) {
    this.shadowRoot.innerHTML = `
      <ha-card>
        <div style="padding: 16px; color: var(--error-color)">
          ${message}
        </div>
      </ha-card>
    `;
  }

  handleTap(mediaUrl) {
    if (!mediaUrl) return;

    const action = this._config.tap_action || { action: 'url' };
    
    switch (action.action) {
      case 'url':
        window.open(mediaUrl, '_blank');
        break;
      case 'navigate':
        history.pushState(null, '', action.navigation_path);
        window.dispatchEvent(new CustomEvent('location-changed'));
        break;
      case 'more-info':
        this.fireEvent('hass-more-info', { entityId: this._config.entity });
        break;
      case 'call-service': {
        const [domain, service] = action.service.split('.');
        this._hass.callService(domain, service, action.service_data || {});
        break;
      }
      default:
        window.open(mediaUrl, '_blank');
    }
  }

  setupAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }

    const refreshSeconds = parseInt(this._config.refresh_interval) || 60;
    if (refreshSeconds > 0) {
      // Add a small random offset to stagger refreshes across multiple cards (0-15% of refresh interval)
      const maxOffset = Math.floor(refreshSeconds * 0.15) * 1000; // Convert to milliseconds
      const staggerOffset = Math.floor(Math.random() * maxOffset);
      
      console.log(`[Reolink Recording Card] Setting up refresh for ${this._config.entity} with ${refreshSeconds}s interval and ${staggerOffset}ms stagger offset`);
      
      // Add a small initial delay for the first refresh to avoid page load congestion
      setTimeout(() => {
        // Only trigger a refresh if the card is visible in viewport
        if (this.isElementInViewport() && document.visibilityState === 'visible') {
          this.refreshImage();
        }
        
        // Set up recurring refresh interval with stagger offset
        this.refreshInterval = setInterval(() => {
          // Only refresh if the card is visible in viewport and the tab is visible
          if (this.isElementInViewport() && document.visibilityState === 'visible') {
            console.log(`[Reolink Recording Card] Auto-refreshing ${this._config.entity}`);
            this.refreshImage();
          }
        }, refreshSeconds * 1000);
      }, staggerOffset);
      
      // Also refresh when the document becomes visible again (tab switching)
      if (!this._visibilityHandler) {
        this._visibilityHandler = () => {
          if (document.visibilityState === 'visible') {
            console.log(`[Reolink Recording Card] Visibility changed, refreshing ${this._config.entity}`);
            this.refreshImage();
          }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
      }
      
      // Set up intersection observer for viewport detection
      if (!this._intersectionObserver && 'IntersectionObserver' in window) {
        this._intersectionObserver = new IntersectionObserver((entries) => {
          const isVisible = entries[0].isIntersecting;
          if (isVisible) {
            console.log(`[Reolink Recording Card] Card ${this._config.entity} entered viewport, refreshing`);
            this.refreshImage();
          }
        }, { threshold: 0.1 }); // Trigger when at least 10% of the card is visible
        
        // Start observing this element
        this._intersectionObserver.observe(this);
      }
    }
  }
  
  /**
   * Check if the element is currently visible in the viewport
   */
  isElementInViewport() {
    // If we have an intersection observer, we don't need this method
    if ('IntersectionObserver' in window) return true;
    
    // Fallback for browsers that don't support IntersectionObserver
    const rect = this.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }
  
  /**
   * Refresh just the image without redoing the entire card structure
   */
  refreshImage() {
    if (!this._hass || !this._config || !this.cardRendered) return;
    
    // Get updated entity state
    const entity = this._hass.states[this._config.entity];
    if (!entity) return;
    
    const attributes = entity.attributes;
    const entityName = entity.entity_id.split('.')[1].replace(/_/g, ' ');
    const friendlyName = attributes.friendly_name || entityName;
    const title = this._config.title || friendlyName;
    const showState = this._config.show_state !== false;
    
    // Parse existing timestamp from URL if available
    let existingTimestamp = '';
    let urlHasTimestamp = false;
    
    if (attributes.entity_picture && attributes.entity_picture.includes('t=')) {
      const matches = attributes.entity_picture.match(/[?&]t=([^&]+)/);
      if (matches) {
        existingTimestamp = matches[1];
        urlHasTimestamp = true;
        console.log(`[Reolink Recording Card] Found existing timestamp in URL: ${existingTimestamp}`);
      }
    }
    
    // Generate cache buster - use backend timestamp if available and recent, otherwise create new one
    let cacheBuster;
    if (urlHasTimestamp && existingTimestamp.includes('-')) {
      // If the timestamp format is 'time-random', use as is
      cacheBuster = `t=${existingTimestamp}`;
    } else if (urlHasTimestamp) {
      // If there's a timestamp but it doesn't have our format, check if it's recent enough
      try {
        const timestampMs = parseInt(existingTimestamp);
        const now = Date.now();
        const age = now - timestampMs;
        
        // If timestamp is less than 2 minutes old, use it; otherwise generate new one
        if (!isNaN(age) && age < 120000) {
          cacheBuster = `t=${existingTimestamp}`;
        } else {
          cacheBuster = `t=${now}-${Math.floor(Math.random() * 1000)}`;
        }
      } catch (e) {
        // If parsing fails, generate a new timestamp
        cacheBuster = `t=${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      }
    } else {
      // No existing timestamp, generate a new one
      cacheBuster = `t=${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }
    
    // Choose between GIF and JPG based on configuration
    let imageUrl = null;
    let videoUrl = null;
    
    if (this._config.use_jpg && attributes.jpg_picture) {
      // Use JPG if configured and available
      const baseUrl = attributes.jpg_picture;
      imageUrl = baseUrl.includes('?') ? `${baseUrl}&${cacheBuster}` : `${baseUrl}?${cacheBuster}`;
    } else if (attributes.entity_picture) {
      // Otherwise use default entity_picture (usually GIF)
      const baseUrl = attributes.entity_picture;
      imageUrl = baseUrl.includes('?') ? `${baseUrl}&${cacheBuster}` : `${baseUrl}?${cacheBuster}`;
    }
    
    // Apply the same cache busting approach to video URL
    if (attributes.media_url) {
      const baseUrl = attributes.media_url;
      videoUrl = baseUrl.includes('?') ? `${baseUrl}&${cacheBuster}` : `${baseUrl}?${cacheBuster}`;
    }
    
    // Update the image source and other card info
    this.updateImageSource(imageUrl, videoUrl, attributes, title, showState);
  }

  fireEvent(type, detail) {
    const event = new CustomEvent(type, {
      detail,
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }
}

class ReolinkRecordingCardEditor extends HTMLElement {
  static get properties() {
    return {
      hass: {},
      _config: {},
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
  }

  setConfig(config) {
    this._config = {
      ...ReolinkRecordingCard.getStubConfig(),
      ...config
    };
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  render() {
    if (!this._hass) return;

    // Get entities that look like Reolink recording sensors
    const entities = Object.keys(this._hass.states)
      .filter(entityId => entityId.startsWith('sensor.') && 
                          (entityId.includes('_latest_recording') || 
                           entityId.includes('_recording')))
      .map(entityId => ({
        value: entityId,
        label: this._hass.states[entityId].attributes.friendly_name || entityId
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Clear the shadow root and create elements programmatically
    this.shadowRoot.innerHTML = '';
    
    // Create styles
    const style = document.createElement('style');
    style.textContent = `
      .form {
        display: flex;
        flex-direction: column;
        padding: 16px;
        font-family: var(--paper-font-body1_-_font-family);
      }
      .row {
        display: flex;
        flex-direction: column;
        margin-bottom: 16px;
      }
      .row label {
        margin-bottom: 8px;
        font-weight: 500;
        color: var(--primary-text-color);
      }
      select, input[type="text"], input[type="number"] {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 4px;
        background-color: var(--card-background-color);
        color: var(--primary-text-color);
        font-size: 14px;
        box-sizing: border-box;
      }
      select:focus, input:focus {
        outline: none;
        border-color: var(--primary-color);
        box-shadow: 0 0 0 2px rgba(var(--rgb-primary-color), 0.2);
      }
      .help {
        color: var(--secondary-text-color);
        font-size: 12px;
        margin-top: 4px;
      }
      .switch-row {
        display: flex;
        align-items: center;
        margin-bottom: 16px;
      }
      .switch-row label {
        flex-grow: 1;
        margin-bottom: 0;
        margin-right: 16px;
      }
      input[type="checkbox"] {
        width: auto;
        margin: 0;
      }
    `;
    
    // Create form container
    const form = document.createElement('div');
    form.className = 'form';
    
    // Entity selection
    const entityRow = this._createRow('Entity', 'Select the Reolink recording sensor entity');
    const entitySelect = document.createElement('select');
    entitySelect.id = 'entity';
    entitySelect.addEventListener('change', this._handleChange.bind(this));
    
    // Add empty option
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'Select an entity...';
    entitySelect.appendChild(emptyOption);
    
    // Add entity options
    entities.forEach(entity => {
      const option = document.createElement('option');
      option.value = entity.value;
      option.textContent = entity.label;
      if (entity.value === this._config.entity) {
        option.selected = true;
      }
      entitySelect.appendChild(option);
    });
    
    entityRow.insertBefore(entitySelect, entityRow.lastElementChild);
    form.appendChild(entityRow);
    
    // Title input
    const titleRow = this._createRow('Title', 'Optional custom title (leave empty for auto title)');
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.id = 'title';
    titleInput.value = this._config.title || '';
    titleInput.placeholder = 'Custom title...';
    titleInput.addEventListener('change', this._handleChange.bind(this));
    titleRow.insertBefore(titleInput, titleRow.lastElementChild);
    form.appendChild(titleRow);
    
    // Refresh interval input
    const refreshRow = this._createRow('Refresh Interval', 'How often to refresh the image (10-3600 seconds)');
    const refreshInput = document.createElement('input');
    refreshInput.type = 'number';
    refreshInput.id = 'refresh_interval';
    refreshInput.min = '10';
    refreshInput.max = '3600';
    refreshInput.value = this._config.refresh_interval || '60';
    refreshInput.addEventListener('change', this._handleChange.bind(this));
    refreshRow.insertBefore(refreshInput, refreshRow.lastElementChild);
    form.appendChild(refreshRow);
    
    // Show title checkbox
    const showTitleRow = this._createSwitchRow('Show Title', 'show_title', this._config.show_title !== false);
    form.appendChild(showTitleRow);
    
    // Show state checkbox
    const showStateRow = this._createSwitchRow('Show State', 'show_state', this._config.show_state !== false);
    form.appendChild(showStateRow);
    
    // Use JPG checkbox
    const useJpgRow = this._createSwitchRow('Use JPG Instead of GIF', 'use_jpg', this._config.use_jpg === true);
    form.appendChild(useJpgRow);
    
    // Tap action selection
    const tapActionRow = this._createRow('Tap Action', '');
    const tapActionSelect = document.createElement('select');
    tapActionSelect.id = 'tap_action';
    tapActionSelect.addEventListener('change', this._handleTapActionChange.bind(this));
    
    const actions = [
      { value: 'url', label: 'Open Video URL' },
      { value: 'more-info', label: 'More Info' },
      { value: 'navigate', label: 'Navigate' },
      { value: 'call-service', label: 'Call Service' }
    ];
    
    actions.forEach(action => {
      const option = document.createElement('option');
      option.value = action.value;
      option.textContent = action.label;
      if (action.value === (this._config.tap_action?.action || 'url')) {
        option.selected = true;
      }
      tapActionSelect.appendChild(option);
    });
    
    tapActionRow.insertBefore(tapActionSelect, tapActionRow.lastElementChild);
    form.appendChild(tapActionRow);
    
    // Dynamic fields based on tap action
    this._addDynamicFields(form);
    
    // Add everything to shadow root
    this.shadowRoot.appendChild(style);
    this.shadowRoot.appendChild(form);
  }
  
  _createRow(labelText, helpText) {
    const row = document.createElement('div');
    row.className = 'row';
    
    const label = document.createElement('label');
    label.textContent = labelText;
    row.appendChild(label);
    
    if (helpText) {
      const help = document.createElement('div');
      help.className = 'help';
      help.textContent = helpText;
      row.appendChild(help);
    }
    
    return row;
  }
  
  _createSwitchRow(labelText, id, checked) {
    const row = document.createElement('div');
    row.className = 'switch-row';
    
    const label = document.createElement('label');
    label.textContent = labelText;
    row.appendChild(label);
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.checked = checked;
    checkbox.addEventListener('change', this._handleChange.bind(this));
    row.appendChild(checkbox);
    
    return row;
  }
  
  _addDynamicFields(form) {
    const tapAction = this._config.tap_action?.action || 'url';
    
    if (tapAction === 'navigate') {
      const navRow = this._createRow('Navigation Path', 'Example: /lovelace/cameras');
      const navInput = document.createElement('input');
      navInput.type = 'text';
      navInput.id = 'navigation_path';
      navInput.value = this._config.tap_action?.navigation_path || '';
      navInput.placeholder = '/lovelace/cameras';
      navInput.addEventListener('change', this._handleTapValueChange.bind(this));
      navRow.insertBefore(navInput, navRow.lastElementChild);
      form.appendChild(navRow);
    }
    
    if (tapAction === 'call-service') {
      const serviceRow = this._createRow('Service', 'Example: media_player.play_media');
      const serviceInput = document.createElement('input');
      serviceInput.type = 'text';
      serviceInput.id = 'service';
      serviceInput.value = this._config.tap_action?.service || '';
      serviceInput.placeholder = 'media_player.play_media';
      serviceInput.addEventListener('change', this._handleTapValueChange.bind(this));
      serviceRow.insertBefore(serviceInput, serviceRow.lastElementChild);
      form.appendChild(serviceRow);
    }
  }
  
  _handleChange(ev) {
    if (!this._config || !this._hass) return;

    const target = ev.target;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    
    if (value === this._config[target.id]) return;
    
    this._config = {
      ...this._config,
      [target.id]: value
    };

    this._fireConfigChanged();
  }
  
  _handleTapActionChange(ev) {
    if (!this._config || !this._hass) return;

    const action = ev.target.value;

    this._config = {
      ...this._config,
      tap_action: {
        action
      }
    };

    this._fireConfigChanged();
    this.render(); // Re-render to show/hide dynamic fields
  }
  
  _handleTapValueChange(ev) {
    if (!this._config || !this._config.tap_action || !this._hass) return;

    const target = ev.target;
    const key = target.id;
    const value = target.value;

    this._config = {
      ...this._config,
      tap_action: {
        ...this._config.tap_action,
        [key]: value
      }
    };

    this._fireConfigChanged();
  }

  _fireConfigChanged() {
    const event = new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true
    });
    this.dispatchEvent(event);
  }
}

// Defensive registration pattern for reliability on slower devices
const CARD_VERSION = '1.1.0';
const CARD_NAME = 'Reolink Recording Card';

function registerReolinkCard() {
  try {
    // Defensive check - don't register if already registered
    if (customElements.get('reolink-recording-card')) {
      console.info(`%c REOLINK-RECORDING-CARD %c v${CARD_VERSION} already registered `, 
        'color: orange; font-weight: bold; background: black', 
        'color: white; font-weight: bold; background: dimgray');
      return;
    }

    // Initialize customCards registry
    window.customCards = window.customCards || [];
    
    // Check if already in registry to avoid duplicates
    const existingCard = window.customCards.find(card => card.type === 'reolink-recording-card');
    if (!existingCard) {
      window.customCards.push({
        type: 'reolink-recording-card',
        name: CARD_NAME,
        description: 'A card to display Reolink camera recordings with auto-refresh',
        preview: true
      });
    }

    // Register custom elements
    customElements.define('reolink-recording-card', ReolinkRecordingCard);
    customElements.define('reolink-recording-card-editor', ReolinkRecordingCardEditor);

    console.info(`%c REOLINK-RECORDING-CARD %c v${CARD_VERSION} loaded `, 
      'color: orange; font-weight: bold; background: black', 
      'color: white; font-weight: bold; background: dimgray');
      
  } catch (error) {
    console.error('Failed to register Reolink Recording Card:', error);
    // Retry registration after a short delay for slower devices
    setTimeout(() => {
      console.warn('Retrying Reolink Recording Card registration...');
      registerReolinkCard();
    }, 1000);
  }
}

// Multiple registration strategies for maximum compatibility
if (document.readyState === 'loading') {
  // DOM still loading - wait for DOMContentLoaded
  document.addEventListener('DOMContentLoaded', registerReolinkCard);
} else {
  // DOM already loaded - register immediately
  registerReolinkCard();
}

// Fallback registration on window load (for very slow devices)
window.addEventListener('load', () => {
  if (!customElements.get('reolink-recording-card')) {
    console.warn('Reolink Recording Card not registered yet, trying fallback registration...');
    registerReolinkCard();
  }
});
