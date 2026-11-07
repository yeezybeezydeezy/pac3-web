// Global key / mouse tracking for events (button, is_firing) and play mode.
const NAMES = { ' ': 'space', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', escape: 'escape', control: 'control', meta: 'meta' };

export const isTyping = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export class Input {
  constructor() {
    this.down = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseEnabled = false;
    addEventListener('keydown', (e) => { if (!isTyping(e.target)) this.down.add(this.keyName(e)); });
    addEventListener('keyup', (e) => this.down.delete(this.keyName(e)));
    addEventListener('blur', () => this.down.clear());
    addEventListener('pointermove', (e) => { this.mouseX = (e.clientX / innerWidth) * 2 - 1; this.mouseY = -((e.clientY / innerHeight) * 2 - 1); });
    addEventListener('pointerup', (e) => this.down.delete(e.button === 2 ? 'mouse_right' : e.button === 1 ? 'mouse_middle' : 'mouse_left'));
  }
  keyName(e) {
    if (e.code && /^Digit\d$/.test(e.code)) return e.code.slice(5);
    const k = String(e.key || '').toLowerCase();
    return NAMES[k] || k;
  }
  /** Called by play mode for mouse buttons on the canvas. */
  mouseDown(button) { if (this.mouseEnabled) this.down.add(button === 2 ? 'mouse_right' : button === 1 ? 'mouse_middle' : 'mouse_left'); }
  isDown(k) { return this.down.has(k); }
}
