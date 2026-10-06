// Minimal stand-in for Home Assistant's <ha-card>, styled with the same theme variables.
if (!customElements.get('ha-card')) {
  customElements.define('ha-card', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = `<style>
        :host { display: block; background: var(--ha-card-background, var(--card-background-color));
          border: 1px solid var(--ha-card-border-color, var(--divider-color)); border-radius: var(--ha-card-border-radius, 12px);
          color: var(--primary-text-color); }
      </style><slot></slot>`;
    }
  });
}
