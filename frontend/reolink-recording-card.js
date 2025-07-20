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
    const title = this._config.title || attributes.friendly_name || entity.entity_id;
    const showTitle = this._config.show_title !== false;
    const showState = this._config.show_state !== false;
    
    // Cache busting with timestamp
    const timestamp = Date.now();
    const imageUrl = attributes.entity_picture ? `${attributes.entity_picture}&t=${timestamp}` : null;
    const videoUrl = attributes.media_url ? `${attributes.media_url}&t=${timestamp}` : null;

    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          overflow: hidden;
          padding: 0;
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
        .header {
          padding: 16px 16px 8px;
        }
        .title {
          font-size: 1.2em;
          font-weight: 500;
          margin: 0;
        }
        .state-info {
          padding: 8px 16px 16px;
          color: var(--secondary-text-color);
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
        ${showTitle ? `
          <div class="header">
            <h2 class="title">${title}</h2>
          </div>
        ` : ''}

        <div class="image-container">
          ${imageUrl ? `
            <img src="${imageUrl}" alt="${title}" />
            <div class="play-icon">
              <svg viewBox="0 0 24 24">
                <path d="M8,5.14V19.14L19,12.14L8,5.14Z" />
              </svg>
            </div>
          ` : `
            <div class="no-image">No image available</div>
          `}
        </div>

        ${showState ? `
          <div class="state-info">
            <div>State: ${entity.state}</div>
            ${attributes.last_motion ? `<div>Last Motion: ${attributes.last_motion}</div>` : ''}
            ${attributes.timestamp ? `<div>Timestamp: ${attributes.timestamp}</div>` : ''}
          </div>
        ` : ''}
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

// Register the custom elements
customElements.define('reolink-recording-card', ReolinkRecordingCard);
customElements.define('reolink-recording-card-editor', ReolinkRecordingCardEditor);

// More robust registration with Home Assistant
// Wait for the window to fully load before registering the card
window.addEventListener('load', () => {
  // Small delay to ensure Home Assistant frontend is fully initialized
  setTimeout(() => {
    // Tell Home Assistant about the card
    window.customCards = window.customCards || [];
    window.customCards.push({
      type: 'reolink-recording-card',
      name: 'Reolink Recording Card',
      description: 'A card to display Reolink camera recordings with auto-refresh'
    });
    
    console.info(
      '%c REOLINK-RECORDING-CARD %c v1.0.0 ',
      'color: orange; font-weight: bold; background: black',
      'color: white; font-weight: bold; background: dimgray'
    );
    
    console.info('Reolink Recording Card successfully registered with Home Assistant');
  }, 100); // Small delay to ensure proper registration timing
});
