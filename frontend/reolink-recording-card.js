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

    this.shadowRoot.innerHTML = `
      <style>
        .form {
          display: flex;
          flex-direction: column;
          padding: 16px;
        }
        .row {
          display: flex;
          flex-direction: column;
          margin-bottom: 16px;
        }
        .row label {
          margin-bottom: 4px;
        }
        mwc-select, mwc-textfield {
          width: 100%;
        }
        .help {
          color: var(--secondary-text-color);
          font-size: 12px;
          margin-top: 4px;
        }
        .switch-row {
          display: flex;
          align-items: center;
          margin-bottom: 8px;
        }
        .switch-row label {
          flex-grow: 1;
        }
      </style>
      
      <div class="form">
        <div class="row">
          <label for="entity">Entity</label>
          <mwc-select
            id="entity"
            label="Entity"
            .value=${this._config.entity || ''}
            @selected=${this._valueChanged}
            @closed=${(e) => e.stopPropagation()}
            fixedMenuPosition
            naturalMenuWidth
          >
            ${entities.map(entity => `
              <mwc-list-item .value=${entity.value}>${entity.label}</mwc-list-item>
            `).join('')}
          </mwc-select>
          <div class="help">Select the Reolink recording sensor entity</div>
        </div>

        <div class="row">
          <label for="title">Title</label>
          <mwc-textfield
            id="title"
            label="Title"
            .value=${this._config.title || ''}
            @change=${this._valueChanged}
          ></mwc-textfield>
          <div class="help">Optional custom title (leave empty for auto title)</div>
        </div>

        <div class="row">
          <label for="refresh">Refresh Interval</label>
          <mwc-textfield
            id="refresh_interval"
            label="Refresh Interval (seconds)"
            type="number"
            min="10"
            max="3600"
            .value=${this._config.refresh_interval || '60'}
            @change=${this._valueChanged}
          ></mwc-textfield>
          <div class="help">How often to refresh the image (10-3600 seconds)</div>
        </div>

        <div class="switch-row">
          <label for="show_title">Show Title</label>
          <mwc-switch
            id="show_title"
            .checked=${this._config.show_title !== false}
            @change=${this._valueChanged}
          ></mwc-switch>
        </div>

        <div class="switch-row">
          <label for="show_state">Show State</label>
          <mwc-switch
            id="show_state"
            .checked=${this._config.show_state !== false}
            @change=${this._valueChanged}
          ></mwc-switch>
        </div>

        <div class="row">
          <label for="tap_action">Tap Action</label>
          <mwc-select
            id="tap_action"
            label="Action"
            .value=${this._config.tap_action?.action || 'url'}
            @selected=${this._actionChanged}
            @closed=${(e) => e.stopPropagation()}
            fixedMenuPosition
          >
            <mwc-list-item value="url">Open Video URL</mwc-list-item>
            <mwc-list-item value="more-info">More Info</mwc-list-item>
            <mwc-list-item value="navigate">Navigate</mwc-list-item>
            <mwc-list-item value="call-service">Call Service</mwc-list-item>
          </mwc-select>
        </div>

        ${this._config.tap_action?.action === 'navigate' ? `
          <div class="row">
            <label for="navigation_path">Navigation Path</label>
            <mwc-textfield
              id="navigation_path"
              label="Path"
              .value=${this._config.tap_action?.navigation_path || ''}
              @change=${this._tapValueChanged}
            ></mwc-textfield>
            <div class="help">Example: /lovelace/cameras</div>
          </div>
        ` : ''}

        ${this._config.tap_action?.action === 'call-service' ? `
          <div class="row">
            <label for="service">Service</label>
            <mwc-textfield
              id="service"
              label="Service"
              .value=${this._config.tap_action?.service || ''}
              @change=${this._tapValueChanged}
            ></mwc-textfield>
            <div class="help">Example: media_player.play_media</div>
          </div>
        ` : ''}
      </div>
    `;
  }

  _valueChanged(ev) {
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

  _actionChanged(ev) {
    if (!this._config || !this._hass) return;

    const target = ev.target;
    const action = target.value;

    this._config = {
      ...this._config,
      tap_action: {
        ...this._config.tap_action,
        action
      }
    };

    this._fireConfigChanged();
  }

  _tapValueChanged(ev) {
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
