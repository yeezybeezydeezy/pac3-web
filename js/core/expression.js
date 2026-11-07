// Safe, Lua-flavoured expression compiler for proxy parts. Never uses eval/Function:
// expressions come from shared outfits and are untrusted.
//   sin(time() * 4) * 10, owner_velocity_length() / 100
//   hsv_to_color(time() * 50, 1, 1)          (multiple results -> vector)
//   is_crouching() > 0 and 20 or 5            (Lua style and/or)

const MAX_LEN = 4000;
const MAX_TOKENS = 1500;
const MAX_DEPTH = 80;

const BINARY = {
  or: [1, 'L'], and: [2, 'L'],
  '<': [3, 'L'], '>': [3, 'L'], '<=': [3, 'L'], '>=': [3, 'L'], '==': [3, 'L'], '~=': [3, 'L'],
  '+': [4, 'L'], '-': [4, 'L'], '*': [5, 'L'], '/': [5, 'L'], '%': [5, 'L'], '^': [7, 'R'],
};
const ALIAS = { '&&': 'and', '||': 'or', '!': 'not', '!=': '~=', '**': '^' };

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const rest = src.slice(i);
    let m;
    if ((m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(rest))) { out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; }
    else if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
      const w = m[0];
      if (w === 'and' || w === 'or' || w === 'not') out.push({ t: 'op', v: w });
      else if (w === 'true' || w === 'false') out.push({ t: 'lit', v: w === 'true' });
      else if (w === 'nil') out.push({ t: 'lit', v: null });
      else out.push({ t: 'id', v: w });
      i += w.length;
    } else if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1);
      if (end < 0) throw new Error('unterminated string');
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
    } else if ((m = /^(<=|>=|==|~=|!=|&&|\|\||\*\*|[-+*/%^<>(),!])/.exec(rest))) {
      const v = ALIAS[m[0]] || m[0];
      out.push({ t: v === '(' || v === ')' || v === ',' ? v : 'op', v });
      i += m[0].length;
    } else throw new Error(`unexpected character "${ch}"`);
    if (out.length > MAX_TOKENS) throw new Error('expression too long');
  }
  return out;
}

export const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v === true) return 1;
  if (v === false || v == null) return 0;
  if (Array.isArray(v)) return num(v[0]);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const truthy = (v) => v !== false && v != null;
const first = (v) => (Array.isArray(v) ? v[0] : v);

const OPS = {
  '+': (a, b) => num(a) + num(b),
  '-': (a, b) => num(a) - num(b),
  '*': (a, b) => num(a) * num(b),
  '/': (a, b) => num(a) / num(b),
  '%': (a, b) => { const x = num(a), y = num(b); return x - Math.floor(x / y) * y; },
  '^': (a, b) => Math.pow(num(a), num(b)),
  '<': (a, b) => num(a) < num(b),
  '>': (a, b) => num(a) > num(b),
  '<=': (a, b) => num(a) <= num(b),
  '>=': (a, b) => num(a) >= num(b),
  '==': (a, b) => (typeof first(a) === 'string' || typeof first(b) === 'string' ? String(first(a)) === String(first(b)) : num(a) === num(b)),
  '~=': (a, b) => !OPS['=='](a, b),
};

/**
 * Compiles an expression. env.functions: name -> fn(ctx, ...args); env.constants: name -> value.
 * Returns (ctx) => number[].
 */
export function compileExpression(src, env) {
  src = String(src);
  if (src.length > MAX_LEN) throw new Error('expression too long');
  const toks = tokenize(src);
  let i = 0;
  let depth = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const expect = (t) => { const k = next(); if (!k || k.t !== t) throw new Error(`expected "${t}"`); return k; };

  function parseExpr(minPrec) {
    if (++depth > MAX_DEPTH) throw new Error('expression nested too deeply');
    let left = parseUnary();
    for (;;) {
      const k = peek();
      if (!k || k.t !== 'op' || !BINARY[k.v]) break;
      const [prec, assoc] = BINARY[k.v];
      if (prec < minPrec) break;
      next();
      const right = parseExpr(assoc === 'R' ? prec : prec + 1);
      const l = left;
      if (k.v === 'and') left = (c) => { const a = l(c); return truthy(first(a)) ? right(c) : a; };
      else if (k.v === 'or') left = (c) => { const a = l(c); return truthy(first(a)) ? a : right(c); };
      else { const f = OPS[k.v]; left = (c) => f(l(c), right(c)); }
    }
    depth--;
    return left;
  }

  function parseUnary() {
    const k = peek();
    if (k && k.t === 'op' && (k.v === '-' || k.v === '+' || k.v === 'not')) {
      next();
      const operand = parseExpr(6);
      if (k.v === '-') return (c) => -num(operand(c));
      if (k.v === 'not') return (c) => !truthy(first(operand(c)));
      return (c) => num(operand(c));
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const k = next();
    if (!k) throw new Error('unexpected end of expression');
    if (k.t === 'num' || k.t === 'str' || k.t === 'lit') { const v = k.v; return () => v; }
    if (k.t === '(') { const e = parseExpr(1); expect(')'); return (c) => first(e(c)); }
    if (k.t === 'id') {
      const name = k.v;
      if (peek() && peek().t === '(') {
        next();
        const args = [];
        if (!peek() || peek().t !== ')') {
          for (;;) { args.push(parseExpr(1)); if (peek() && peek().t === ',') { next(); continue; } break; }
        }
        expect(')');
        const fn = Object.hasOwn(env.functions, name) ? env.functions[name] : null;
        if (!fn) throw new Error(`unknown function "${name}"`);
        return (c) => {
          const vals = [];
          for (const a of args) { const v = a(c); if (Array.isArray(v)) vals.push(...v); else vals.push(v); }
          return fn(c, ...vals);
        };
      }
      if (Object.hasOwn(env.constants, name)) { const v = env.constants[name]; return () => v; }
      const fn = Object.hasOwn(env.functions, name) ? env.functions[name] : null;
      if (fn) return (c) => fn(c);
      throw new Error(`unknown name "${name}"`);
    }
    throw new Error(`unexpected "${k.v}"`);
  }

  if (!toks.length) throw new Error('empty expression');
  const list = [parseExpr(1)];
  while (peek() && peek().t === ',') { next(); list.push(parseExpr(1)); }
  if (i < toks.length) throw new Error(`unexpected "${peek().v}"`);
  return (ctx) => {
    const out = [];
    for (const e of list) { const v = e(ctx); if (Array.isArray(v)) for (const x of v) out.push(num(x)); else out.push(num(v)); }
    return out;
  };
}
