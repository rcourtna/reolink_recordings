/**
 * Reolink Recording Card for Home Assistant
 * v1.0.0
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

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this.refreshInterval = null;
  }

  setConfig(config) {
    if (!config) {
      throw new Error('Invalid configuration');
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
  }

  render() {
    if (!this._hass || !this._config) return;

    if (!this._config.entity) {
      this.shadowRoot.innerHTML = `
        <ha-card>
          <div style="padding: 16px; color: var(--error-color)">
            Please define an entity
          </div>
        </ha-card>
      `;
      return;
    }

    const entity = this._hass.states[this._config.entity];
    if (!entity) {
      this.shadowRoot.innerHTML = `
        <ha-card>
          <div style="padding: 16px; color: var(--error-color)">
            Entity not found: ${this._config.entity}
          </div>
        </ha-card>
      `;
      return;
    }

    const attributes = entity.attributes;
    // Force a clear title value with debugging
    const entityName = entity.entity_id.split('.')[1].replace(/_/g, ' ');
    const friendlyName = attributes.friendly_name || entityName;
    const title = this._config.title || friendlyName;
    
    console.log('Reolink Card - Title:', title, 'Entity:', entity.entity_id);
    
    const showTitle = true; // Always show title
    const showState = this._config.show_state !== false;
    
    // Cache busting with timestamp
    const timestamp = Date.now();
    
    // Choose between GIF and JPG based on configuration
    let imageUrl = null;
    if (this._config.use_jpg && attributes.jpg_picture) {
      // Use JPG if configured and available
      imageUrl = `${attributes.jpg_picture}&t=${timestamp}`;
    } else {
      // Otherwise use default entity_picture (usually GIF)
      imageUrl = attributes.entity_picture ? `${attributes.entity_picture}&t=${timestamp}` : null;
    }
    
    const videoUrl = attributes.media_url ? `${attributes.media_url}&t=${timestamp}` : null;

    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          overflow: hidden;
          padding: 0;
          border: none;
          background: transparent;
          box-shadow: none;
        }
        /* Main container styles */
        
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
        }
        img {
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
        .state-info {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 70%, rgba(0,0,0,0) 100%);
          color: white;
          padding: 10px;
          text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
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
        <!-- Image container with overlaid text -->
        <div class="image-container">
          ${imageUrl ? `
            <img src="${imageUrl}" alt="${title}" />
            
            
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
          ` : `
            <div class="no-image">No image available</div>
          `}
        </div>
      </ha-card>
    `;

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
    }

    const refreshSeconds = parseInt(this._config.refresh_interval) || 60;
    if (refreshSeconds > 0) {
      this.refreshInterval = setInterval(() => {
        this.render();
      }, refreshSeconds * 1000);
    }
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

// Robust registration with retry mechanism to avoid race conditions with Home Assistant
// This approach attempts registration multiple times with increasing delays
const CARD_VERSION = '1.0.0';
const CARD_NAME = 'Reolink Recording Card';

// Card registration function with retry capability
const registerCard = (function() {
  // Registration configuration
  const config = {
    type: 'reolink-recording-card',
    name: CARD_NAME,
    description: 'A card to display Reolink camera recordings with auto-refresh'
  };
  
  // Check if card is already registered
  const isRegistered = () => {
    if (!window.customCards) return false;
    return window.customCards.some(card => card.type === config.type);
  };
  
  // Log with consistent styling
  const log = (message, isError = false) => {
    const style = 'color: white; font-weight: bold; background: ' + 
                 (isError ? '#c42929' : 'dimgray');
    const headerStyle = 'color: orange; font-weight: bold; background: black';
    
    console[isError ? 'error' : 'info'](
      `%c REOLINK-RECORDING-CARD %c ${message} `, 
      headerStyle, 
      style
    );
  };
  
  // The actual registration function
  return function(maxRetries = 5, initialDelay = 100) {
    // If already registered, don't try again
    if (isRegistered()) {
      log(`v${CARD_VERSION} (already registered)`);
      return;
    }
    
    let retries = 0;
    
    const attemptRegistration = () => {
      try {
        // Only define the custom elements if they haven't been defined yet
        // This prevents the "has already been used" error
        if (!customElements.get('reolink-recording-card')) {
          customElements.define('reolink-recording-card', ReolinkRecordingCard);
          log('Defined reolink-recording-card custom element');
        }
        
        if (!customElements.get('reolink-recording-card-editor')) {
          customElements.define('reolink-recording-card-editor', ReolinkRecordingCardEditor);
          log('Defined reolink-recording-card-editor custom element');
        }
        
        // Initialize customCards array if needed and register the card
        window.customCards = window.customCards || [];
        
        // Only add to customCards if not already present
        if (!window.customCards.some(card => card.type === config.type)) {
          window.customCards.push(config);
          log(`v${CARD_VERSION} registered successfully after ${retries} ${retries === 1 ? 'retry' : 'retries'}`);
        } else {
          log(`v${CARD_VERSION} already in customCards registry`);
        }
      } catch (e) {
        // If we haven't exceeded max retries, try again with exponential backoff
        if (retries < maxRetries) {
          retries++;
          const delay = initialDelay * Math.pow(2, retries - 1); // Exponential backoff
          log(`Registration attempt ${retries}/${maxRetries} failed: ${e.message}, retrying in ${delay}ms...`);
          
          setTimeout(attemptRegistration, delay);
        } else {
          // We've failed after max retries
          log(`Failed to register card after ${maxRetries} attempts: ${e.message}`, true);
        }
      }
    };
    
    // Start the registration process
    log(`v${CARD_VERSION} attempting registration...`);
    attemptRegistration();
  };
})();

// Register the custom elements
customElements.define('reolink-recording-card', ReolinkRecordingCard);
customElements.define('reolink-recording-card-editor', ReolinkRecordingCardEditor);

// Wait for the window to fully load before starting registration
window.addEventListener('load', () => {
  // Small initial delay to ensure Home Assistant is starting to initialize
  setTimeout(() => {
    registerCard(5, 200); // 5 retries, starting with 200ms delay
  }, 100);
});
