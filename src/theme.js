// HA theme colours (CSS variables) converted to opaque hex for three.js.

// Targets: the first three categorical colours of the reference palette, one step per mode.
// Validated together (all pairs) for colour-vision deficiency and contrast on light and dark cards.
const TARGETS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a'],
  dark: ['#3987e5', '#d95926', '#199e70'],
};

// Heatmap: one sequential blue ramp. "Little time" recedes into the card, so it runs light → dark on a
// light card and dark → light on a dark one.
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

let probe;
function rgbOf(value) {
  probe ??= document.createElement('canvas').getContext('2d');
  probe.fillStyle = '#010203';
  probe.fillStyle = value;
  const out = probe.fillStyle;
  if (out === '#010203' && value.replace(/\s/g, '').toLowerCase() !== '#010203') return null;  // invalid colour
  if (out.startsWith('#')) return { r: parseInt(out.slice(1, 3), 16), g: parseInt(out.slice(3, 5), 16), b: parseInt(out.slice(5, 7), 16), a: 1 };
  const [r, g, b, a = 1] = out.match(/[\d.]+/g).map(Number);
  return { r, g, b, a };
}

const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** CSS colour to hex. Translucent colours (e.g. --divider-color) are blended over `over`. */
export function cssColor(value, fallback, over) {
  const c = value ? rgbOf(value) : null;
  if (!c) return fallback;
  if (c.a >= 1 || !over) return hex(c);
  const o = rgbOf(over);
  return hex({ r: c.r * c.a + o.r * (1 - c.a), g: c.g * c.a + o.g * (1 - c.a), b: c.b * c.a + o.b * (1 - c.a) });
}

export function mix(a, b, t) {
  const ca = rgbOf(a), cb = rgbOf(b);
  return hex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t });
}

export function readTheme(el, dark) {
  const cs = getComputedStyle(el);
  const v = (name) => cs.getPropertyValue(name).trim();
  const bg = cssColor(v('--ha-card-background') || v('--card-background-color'), dark ? '#1c1c1c' : '#ffffff');
  return {
    dark,
    bg,
    fg: cssColor(v('--primary-text-color'), dark ? '#e1e1e1' : '#212121', bg),
    fg2: cssColor(v('--secondary-text-color'), dark ? '#9b9b9b' : '#727272', bg),
    line: cssColor(v('--divider-color'), dark ? '#2f2f2f' : '#e0e0e0', bg),
    accent: cssColor(v('--primary-color'), '#03a9f4', bg),
    exclude: cssColor(v('--error-color'), '#db4437', bg),
    targets: dark ? TARGETS.dark : TARGETS.light,
    ramp: dark ? RAMP.slice(0, -1).reverse() : RAMP,   // on dark cards the darkest step would vanish into the floor
  };
}
