/**
 * Reolink Summary Card for Home Assistant
 * A custom card that pulls together all Reolink recordings,
 * sorts them by recency, and displays them dynamically.
 */
class ReolinkSummaryCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement('reolink-summary-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'Recent Activity',
      refresh_interval: 60,
      auto_discover: true,
      entities: [],
      max_items: 5,
      show_state: true,
      use_jpg: true,
      tap_action: { action: 'url' }
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this.refreshInterval = null;
    this.cardRendered = false;
  }

  setConfig(config) {
    if (!config) {
      this._config = ReolinkSummaryCard.getStubConfig();
      return;
    }
    
    this._config = {
      ...ReolinkSummaryCard.getStubConfig(),
      ...config
    };

    // Make sure we have either auto-discover or manual entities
    if (!this._config.auto_discover && (!this._config.entities || this._config.entities.length === 0)) {
      throw new Error("Please define entities or enable auto-discover");
    }
    this.cardRendered = false; // Force re-render on config change
  }

  getCardSize() {
    return 4;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) {
      this.render();
    }
  }

  disconnectedCallback() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  _parseRecordingDate(dateStr, timeStr) {
    if (!dateStr || !timeStr) return new Date(0);
    try {
      const dateParts = dateStr.split('/');
      const timeParts = timeStr.split(':');
      if (dateParts.length === 3 && timeParts.length === 3) {
        return new Date(dateParts[0], dateParts[1] - 1, dateParts[2], timeParts[0], timeParts[1], timeParts[2]);
      }
    } catch(e) {}
    return new Date(0); // fallback
  }

  _getRecordingEntities() {
    let targetEntities = [];
    if (this._config.auto_discover) {
      // Find all sensor entities ending with _latest_recording
      targetEntities = Object.keys(this._hass.states).filter(entityId => 
        entityId.startsWith('sensor.') && (entityId.includes('_latest_recording'))
      );
    } else {
      targetEntities = this._config.entities || [];
    }

    const validRecordings = [];

    targetEntities.forEach(entityId => {
      const stateObj = this._hass.states[entityId];
      if (!stateObj) return;

      const attrs = stateObj.attributes;
      // Skip if missing critical info
      if (!attrs || !attrs.file_path) return;

      const recDate = this._parseRecordingDate(attrs.date, attrs.timestamp);
      
      const entityName = entityId.split('.')[1].replace(/_/g, ' ');
      const friendlyName = attrs.friendly_name || entityName;

      validRecordings.push({
        entityId: entityId,
        dateObj: recDate,
        attributes: attrs,
        name: friendlyName
      });
    });

    // Sort descending by actual recording time
    validRecordings.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());

    // Limit if needed
    const maxItems = this._config.max_items || 5;
    return validRecordings.slice(0, maxItems);
  }

  _getImageUrl(attrs) {
    const existingTimestamp = (attrs.entity_picture && attrs.entity_picture.match(/[?&]t=([^&]+)/)) 
      ? attrs.entity_picture.match(/[?&]t=([^&]+)/)[1] 
      : null;
    
    const cacheBuster = existingTimestamp 
      ? `t=${existingTimestamp}` 
      : `t=${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      
    let baseUrl = '';
    if (this._config.use_jpg && attrs.jpg_picture) {
      baseUrl = attrs.jpg_picture;
    } else if (attrs.entity_picture) {
      baseUrl = attrs.entity_picture;
    } else {
      return null;
    }
    
    return baseUrl.includes('?') ? `${baseUrl}&${cacheBuster}` : `${baseUrl}?${cacheBuster}`;
  }

  _getVideoUrl(attrs) {
    if (!attrs.media_url) return null;
    const existingTimestamp = (attrs.media_url.match(/[?&]t=([^&]+)/)) ? attrs.media_url.match(/[?&]t=([^&]+)/)[1] : null;
    const cacheBuster = existingTimestamp ? `t=${existingTimestamp}` : `t=${Date.now()}`;
    const baseUrl = attrs.media_url;
    return baseUrl.includes('?') ? `${baseUrl}&${cacheBuster}` : `${baseUrl}?${cacheBuster}`;
  }

  render() {
    if (!this._hass || !this._config) return;

    const recordings = this._getRecordingEntities();
    
    if (recordings.length === 0) {
       if (!this.cardRendered) {
         this.shadowRoot.innerHTML = `
           <ha-card header="${this._config.title}">
             <div style="padding: 16px; color: var(--secondary-text-color);">No recordings found. Ensure auto-discovery is enabled or entities are specified.</div>
           </ha-card>
         `;
         this.cardRendered = true;
       }
       return;
    }

    if (!this.cardRendered) {
      this.shadowRoot.innerHTML = `
        <style>
          ha-card {
            overflow: hidden;
            display: flex;
            flex-direction: column;
          }
          .title {
            padding: 16px 16px 8px 16px;
            font-size: 1.2rem;
            font-weight: 500;
            color: var(--primary-text-color);
          }
          
          .grid-container {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 0 16px 16px 16px;
          }
          
          .hero-item {
            position: relative;
            width: 100%;
            border-radius: 8px;
            overflow: hidden;
            cursor: pointer;
            min-height: 200px;
            background: #000;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          }
          
          .secondary-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
          }
          
          .secondary-item {
            position: relative;
            width: 100%;
            border-radius: 6px;
            overflow: hidden;
            cursor: pointer;
            min-height: 100px;
            background: #222;
            opacity: 0.9;
            transition: opacity 0.2s;
            box-shadow: 0 1px 3px rgba(0,0,0,0.15);
          }
          
          .secondary-item:hover {
            opacity: 1;
          }
          
          img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
          
          .overlay-bottom {
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 60%, transparent 100%);
            color: white;
            padding: 12px;
            display: flex;
            flex-direction: column;
            z-index: 5;
          }
          
          .hero-item .overlay-bottom {
            padding: 16px;
          }
          
          .secondary-item .overlay-bottom {
            padding: 8px;
            font-size: 0.85em;
          }
          
          .cam-name {
            font-weight: 600;
            margin-bottom: 2px;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
          }
          .hero-item .cam-name {
             font-size: 1.1em;
          }
          
          .event-meta {
            display: flex;
            justify-content: space-between;
            color: #ddd;
            font-size: 0.9em;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.8);
          }
          .secondary-item .event-meta {
             font-size: 0.8em;
          }
          
          .play-icon {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            opacity: 0;
            background-color: rgba(0, 0, 0, 0.5);
            border-radius: 50%;
            width: 48px;
            height: 48px;
            display: flex;
            justify-content: center;
            align-items: center;
            transition: opacity 0.3s;
            z-index: 10;
          }
          .secondary-item .play-icon {
            width: 32px;
            height: 32px;
          }
          .hero-item:hover .play-icon, .secondary-item:hover .play-icon {
            opacity: 1;
          }
          .play-icon svg {
            width: 28px;
            height: 28px;
            fill: white;
          }
          .secondary-item .play-icon svg {
            width: 18px;
            height: 18px;
          }
          .live-btn {
            position: absolute;
            top: 8px;
            left: 8px;
            background: rgba(0, 0, 0, 0.6);
            color: #ddd;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 500;
            z-index: 10;
            backdrop-filter: blur(2px);
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            border: 1px solid rgba(255,255,255,0.2);
            transition: all 0.2s ease;
          }
          .secondary-item .live-btn {
            top: 6px;
            left: 6px;
            padding: 4px 6px;
            border-radius: 4px;
            border: none;
            background: rgba(0, 0, 0, 0.45);
          }
          .secondary-item .live-btn span {
            display: none; /* Hide the text "Live View" on small cards to save space */
          }
          .live-btn:hover {
            background: rgba(30, 30, 30, 0.9);
            color: white;
            border-color: rgba(255,255,255,0.5);
            transform: scale(1.05);
          }
          .secondary-item .live-btn:hover {
            background: rgba(0, 0, 0, 0.8);
          }
          .live-icon svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
          }
          .relative-time {
             position: absolute;
             top: 8px;
             right: 8px;
             background: rgba(0, 0, 0, 0.6);
             color: white;
             padding: 4px 8px;
             border-radius: 4px;
             font-size: 0.8rem;
             z-index: 5;
             backdrop-filter: blur(2px);
          }
          .secondary-item .relative-time {
             top: 6px;
             right: 6px;
             font-size: 0.65rem;
             padding: 3px 6px;
             background: rgba(0, 0, 0, 0.45);
          }
          .secondary-item .overlay-bottom {
             padding: 8px;
          }
          .secondary-item .cam-name {
             font-size: 0.9em;
             white-space: nowrap;
             overflow: hidden;
             text-overflow: ellipsis;
             margin-bottom: 0px;
          }
          .secondary-item .event-meta {
             font-size: 0.75em;
          }
        </style>


        <ha-card>
          ` + (this._config.title ? '<div class="title">' + this._config.title + '</div>' : '') + `
          <div class="grid-container" id="recordings-container">
             <!-- Content injected dynamically -->
          </div>
        </ha-card>
      `;

      this.cardRendered = true;
      this.setupAutoRefresh();
    }

    this._updateContent(recordings);
  }

  _timeSince(dateObj) {
    const seconds = Math.floor((new Date() - dateObj) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " mins ago";
    return Math.floor(seconds > 0 ? seconds : 0) + " secs ago";
  }
  
  _findLiveCamera(cameraName) {
    if (!this._hass || !this._hass.states || !cameraName) return null;
    const target = cameraName.toLowerCase();
    
    const cameras = Object.keys(this._hass.states).filter(c => c.startsWith('camera.'));
    
    // Find cameras that have a matching friendly name or entity ID
    const matches = cameras.filter(entityId => {
      const attrs = this._hass.states[entityId].attributes || {};
      const friendlyObj = (attrs.friendly_name || entityId).toLowerCase();
      return friendlyObj.includes(target) || entityId.includes(target.replace(/ /g, '_'));
    });
    
    // Prefer higher quality stream
    const clear = matches.find(c => {
         const attrs = this._hass.states[c].attributes || {};
         return (attrs.friendly_name || c).toLowerCase().includes('clear') || c.includes('clear') || c.includes('main');
    });
    if (clear) return clear;
    
    const fluency = matches.find(c => {
         const attrs = this._hass.states[c].attributes || {};
         return (attrs.friendly_name || c).toLowerCase().includes('fluent') || c.includes('fluent') || c.includes('sub');
    });
    if (fluency) return fluency;
    
    return matches.length > 0 ? matches[0] : null;
  }

  _updateContent(recordings) {
    const container = this.shadowRoot.getElementById('recordings-container');
    if (!container) return;

    let html = '';
    const clickHandlers = [];

    recordings.forEach((rec, index) => {
      const isHero = index === 0; // First item is the hero
      const imageUrl = this._getImageUrl(rec.attributes);
      const videoUrl = this._getVideoUrl(rec.attributes);
      const eventType = rec.attributes.event_type || 'Motion';
      const timestamp = rec.attributes.timestamp || '';
      const timeAgo = this._timeSince(rec.dateObj);
      
      // Look up live camera using the clean camera name (e.g. "Pole Barn")
      let cleanName = rec.name.replace(/latest recording/i, '').replace(/_latest_recording/i, '').trim();
      if (!cleanName) cleanName = rec.entityId.replace('sensor.', '').replace('_latest_recording', '');
      
      // Make it beautiful for display (e.g., "first_landing" -> "First Landing")
      if (cleanName.includes('_')) {
        cleanName = cleanName.split('_')
          .filter(Boolean)
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
      }
      // Also capitalize first letter if purely lowercase
      else if (cleanName === cleanName.toLowerCase()) {
        cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
      }
      
      const cameraEntity = this._findLiveCamera(cleanName);
      
      clickHandlers.push({
        id: `rec-${index}`,
        liveId: `live-${index}`,
        index: index,
        url: videoUrl,
        entity: rec.entityId,
        title: cleanName,
        timestamp: timestamp,
        cameraEntity: cameraEntity
      });

      const elementClass = isHero ? 'hero-item' : 'secondary-item';
      
      const liveBtnHtml = cameraEntity ? `
        <div class="live-btn" id="live-` + index + `" title="View Live Camera">
          <div class="live-icon"><svg viewBox="0 0 24 24"><path d="M17,10.5V7A1,1 0 0,0 16,6H4A1,1 0 0,0 3,7V17A1,1 0 0,0 4,18H16A1,1 0 0,0 17,17V13.5L21,17.5V6.5L17,10.5Z"/></svg></div>
          <span>Live View</span>
        </div>` : '';
      
      const itemHtml = `
        <div class="` + elementClass + `" id="rec-` + index + `">
          ` + liveBtnHtml + `
          <div class="relative-time">` + timeAgo + `</div>
          ` + (imageUrl ? '<img src="' + imageUrl + '" alt="' + cleanName + '" loading="lazy"/>' : '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#ccc;">No Image</div>') + `
          <div class="overlay-bottom">
            <div class="cam-name">` + cleanName + `</div>
            <div class="event-meta">
              <span>` + eventType + `</span>
              <span>` + timestamp + `</span>
            </div>
          </div>
          <div class="play-icon">
            <svg viewBox="0 0 24 24"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg>
          </div>
        </div>
      `;

      if (isHero) {
        html += itemHtml;
        if (recordings.length > 1) {
          html += '<div class="secondary-grid">';
        }
      } else {
        html += itemHtml;
      }
    });

    if (recordings.length > 1) {
      html += '</div>'; // Close secondary grid
    }

    container.innerHTML = html;

    // Attach click listeners
    clickHandlers.forEach(handler => {
      const el = this.shadowRoot.getElementById(handler.id);
      if (el && handler.url) {
        el.addEventListener('click', () => {
          this._openModal(handler.url, handler.title, handler.timestamp);
        });
      }
      
      const liveEl = this.shadowRoot.getElementById(handler.liveId);
      if (liveEl && handler.cameraEntity) {
        liveEl.addEventListener('click', (e) => {
          e.stopPropagation(); // prevent modal from opening
          const event = new CustomEvent('hass-more-info', {
            detail: { entityId: handler.cameraEntity }, bubbles: true, composed: true
          });
          this.dispatchEvent(event);
        });
      }
    });
  }

  _openModal(url, title, timestamp) {
    if (!url) return;
    
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); z-index: 999999; display: flex; flex-direction: column; justify-content: center; align-items: center; font-family: var(--paper-font-common-base_-_font-family, sans-serif); opacity: 0; transition: opacity 0.3s ease;';
    
    wrapper.onclick = (e) => {
      if (e.target === wrapper) this._closeModal(wrapper);
    };
    
    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'position: absolute; top: 20px; right: 20px; color: white; font-size: 28px; cursor: pointer; background: rgba(255,255,255,0.2); width: 48px; height: 48px; border-radius: 50%; text-align: center; line-height: 48px; z-index: 2;';
    closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(255,255,255,0.4)';
    closeBtn.onmouseout = () => closeBtn.style.background = 'rgba(255,255,255,0.2)';
    closeBtn.onclick = () => this._closeModal(wrapper);
    
    // Container
    const container = document.createElement('div');
    container.style.cssText = 'width: 90%; max-width: 1000px; background: black; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.6); z-index: 1; transform: scale(0.95); transition: transform 0.3s ease;';
    
    // Header
    const header = document.createElement('div');
    header.style.cssText = 'color: white; padding: 16px 20px; font-size: 1.2rem; background: #1a1a1a; display: flex; justify-content: space-between; border-bottom: 1px solid #333;';
    header.innerHTML = '<span>' + title + '</span><span style="color: #aaa; font-size: 1rem;">' + timestamp + '</span>';
    
    // Video
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.style.cssText = 'width: 100%; display: block; max-height: calc(100vh - 120px); object-fit: contain; background: black; outline: none;';
    
    const source = document.createElement('source');
    source.src = url;
    source.type = 'video/mp4';
    
    video.appendChild(source);
    container.appendChild(header);
    container.appendChild(video);
    wrapper.appendChild(closeBtn);
    wrapper.appendChild(container);
    
    document.body.appendChild(wrapper);
    
    // Animate in
    requestAnimationFrame(() => {
      wrapper.style.opacity = '1';
      container.style.transform = 'scale(1)';
    });
  }

  _closeModal(wrapper) {
    if (!wrapper || !wrapper.parentNode) return;
    wrapper.style.opacity = '0';
    wrapper.children[1].style.transform = 'scale(0.95)';
    setTimeout(() => {
      if (wrapper.parentNode) {
        document.body.removeChild(wrapper);
      }
    }, 300);
  }

  setupAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    const refreshSeconds = parseInt(this._config.refresh_interval) || 60;
    if (refreshSeconds > 0) {
      this.refreshInterval = setInterval(() => {
        if (document.visibilityState === 'visible') {
           this.render(); // Re-fetch logic and re-render completely to check new sorting
        }
      }, refreshSeconds * 1000);
      
      if (!this._visibilityHandler) {
        this._visibilityHandler = () => {
          if (document.visibilityState === 'visible') {
            this.render();
          }
        };
        document.addEventListener('visibilitychange', this._visibilityHandler);
      }
    }
  }
}

// Basic Editor Stub just so it doesn't crash if they try to edit it via UI
class ReolinkSummaryCardEditor extends HTMLElement {
  setConfig(config) { this._config = config; }
  set hass(hass) {}
  render() { 
    this.innerHTML = `<div style="padding:16px;">Summary Card configuration currently requires YAML. Auto discovery will automatically pull in all your Reolink sensors.</div>`; 
  }
}

customElements.define('reolink-summary-card-editor', ReolinkSummaryCardEditor);
customElements.define('reolink-summary-card', ReolinkSummaryCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'reolink-summary-card',
  name: 'Reolink Summary Card',
  preview: true,
  description: 'Displays a timeline sequence of Reolink recent recordings.',
});
