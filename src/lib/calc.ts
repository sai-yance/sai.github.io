/* Safe mathematical expression engine (no eval) + unit conversion tables. */

export interface EvalOpts {
  degrees?: boolean;
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'op'; v: string }
  | { t: 'fn'; v: string }
  | { t: 'lp' }
  | { t: 'rp' };

const FUNCS = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'sqrt', 'cbrt', 'abs', 'exp', 'sq']);
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s+/g, '');
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const raw = s.slice(i, j);
      if ((raw.match(/\./g) ?? []).length > 1) throw new Error('Invalid number');
      const v = parseFloat(raw);
      if (isNaN(v)) throw new Error('Invalid number');
      toks.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      const name = s.slice(i, j).toLowerCase();
      if (FUNCS.has(name)) toks.push({ t: 'fn', v: name });
      else if (name in CONSTS) toks.push({ t: 'num', v: CONSTS[name] });
      else throw new Error(`Unknown name "${name}"`);
      i = j;
      continue;
    }
    if ('+-*/%^!'.includes(c)) {
      toks.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '(') {
      toks.push({ t: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ t: 'rp' });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${c}"`);
  }
  return toks;
}

class Parser {
  private pos = 0;
  constructor(private toks: Token[], private opts: EvalOpts) {}

  parse(): number {
    const v = this.expr();
    if (this.pos < this.toks.length) throw new Error('Unexpected input');
    return v;
  }

  private peek(): Token | undefined {
    return this.toks[this.pos];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === 'op' && t.v === v;
  }

  private expr(): number {
    let v = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.toks[this.pos++] as { t: 'op'; v: string }).v;
      const r = this.term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }

  private term(): number {
    let v = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = (this.toks[this.pos++] as { t: 'op'; v: string }).v;
      const r = this.unary();
      if (op === '*') v *= r;
      else if (op === '/') {
        if (r === 0) throw new Error('Division by zero');
        v /= r;
      } else v %= r;
    }
    return v;
  }

  private unary(): number {
    if (this.isOp('-')) {
      this.pos++;
      return -this.unary();
    }
    if (this.isOp('+')) {
      this.pos++;
      return this.unary();
    }
    return this.power();
  }

  private power(): number {
    const base = this.postfix();
    if (this.isOp('^')) {
      this.pos++;
      return Math.pow(base, this.unary());
    }
    return base;
  }

  private postfix(): number {
    let v = this.primary();
    while (this.isOp('!')) {
      this.pos++;
      v = factorial(v);
    }
    return v;
  }

  private primary(): number {
    const t = this.peek();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.t === 'num') {
      this.pos++;
      return t.v;
    }
    if (t.t === 'lp') {
      this.pos++;
      const v = this.expr();
      const close = this.peek();
      if (!close || close.t !== 'rp') throw new Error('Missing closing parenthesis');
      this.pos++;
      return v;
    }
    if (t.t === 'fn') {
      this.pos++;
      const open = this.peek();
      if (!open || open.t !== 'lp') throw new Error(`Expected "(" after ${t.v}`);
      this.pos++;
      const arg = this.expr();
      const close = this.peek();
      if (!close || close.t !== 'rp') throw new Error('Missing closing parenthesis');
      this.pos++;
      return applyFn(t.v, arg, this.opts);
    }
    throw new Error('Unexpected token');
  }
}

function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n) || n > 170) throw new Error('Factorial needs an integer 0–170');
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

function applyFn(name: string, x: number, opts: EvalOpts): number {
  const deg = !!opts.degrees;
  const toRad = (v: number) => (deg ? (v * Math.PI) / 180 : v);
  const fromRad = (v: number) => (deg ? (v * 180) / Math.PI : v);
  switch (name) {
    case 'sin': return Math.sin(toRad(x));
    case 'cos': return Math.cos(toRad(x));
    case 'tan': return Math.tan(toRad(x));
    case 'asin':
      if (x < -1 || x > 1) throw new Error('asin domain is [-1, 1]');
      return fromRad(Math.asin(x));
    case 'acos':
      if (x < -1 || x > 1) throw new Error('acos domain is [-1, 1]');
      return fromRad(Math.acos(x));
    case 'atan': return fromRad(Math.atan(x));
    case 'ln':
      if (x <= 0) throw new Error('ln needs a positive number');
      return Math.log(x);
    case 'log':
      if (x <= 0) throw new Error('log needs a positive number');
      return Math.log10(x);
    case 'sqrt':
      if (x < 0) throw new Error('sqrt of negative number');
      return Math.sqrt(x);
    case 'cbrt': return Math.cbrt(x);
    case 'abs': return Math.abs(x);
    case 'exp': return Math.exp(x);
    case 'sq': return x * x;
    default: throw new Error(`Unknown function ${name}`);
  }
}

export function evaluate(expression: string, opts: EvalOpts = {}): number {
  const toks = tokenize(expression);
  if (toks.length === 0) throw new Error('Empty expression');
  return new Parser(toks, opts).parse();
}

/** Returns a number when the query is a complete math expression, otherwise null. */
export function tryMathQuery(raw: string): number | null {
  const q = raw.trim().replace(/=+\s*$/, '');
  if (!q || !/\d/.test(q)) return null;
  if (!/^[\d+\-*/%^!().,a-zA-Z×÷− ]+$/.test(q)) return null;
  if (!/[+\-*/%^!a-zA-Z]/.test(q)) return null;
  if (!/[+\-*/%^!(a-zA-Z]/.test(q)) return null;
  try {
    const v = evaluate(q.replace(/,/g, ''));
    if (!isFinite(v) && !isNaN(v)) return null;
    if (isNaN(v)) return null;
    return v;
  } catch {
    return null;
  }
}

export function formatNumber(n: number): string {
  if (isNaN(n)) return 'undefined';
  if (!isFinite(n)) return n > 0 ? '∞' : '-∞';
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return n.toExponential(8);
  return String(parseFloat(n.toPrecision(12)));
}

/* ---------- programmer base conversion ---------- */

export function convertBase(value: string, fromBase: number, toBase: number): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const neg = trimmed.startsWith('-');
  const body = neg ? trimmed.slice(1) : trimmed;
  if (!body) return '';
  const valid = new RegExp(`^[0-${Math.max(1, Math.min(9, fromBase - 1))}${fromBase > 10 ? 'a-' + String.fromCharCode(96 + Math.min(36, fromBase) - 10) : ''}]+$`, 'i');
  if (!valid.test(body)) throw new Error('Invalid digit for base');
  const num = parseInt(body, fromBase);
  if (isNaN(num)) throw new Error('Invalid number');
  return (neg ? '-' : '') + num.toString(toBase).toUpperCase();
}

/* ---------- unit conversion ---------- */

export interface UnitDef {
  id: string;
  label: string;
  toBase: number;
}

export interface UnitCategory {
  id: string;
  label: string;
  units: UnitDef[];
  temperature?: boolean;
}

export const UNIT_CATEGORIES: UnitCategory[] = [
  {
    id: 'length', label: 'Length',
    units: [
      { id: 'mm', label: 'Millimeter (mm)', toBase: 0.001 },
      { id: 'cm', label: 'Centimeter (cm)', toBase: 0.01 },
      { id: 'm', label: 'Meter (m)', toBase: 1 },
      { id: 'km', label: 'Kilometer (km)', toBase: 1000 },
      { id: 'in', label: 'Inch (in)', toBase: 0.0254 },
      { id: 'ft', label: 'Foot (ft)', toBase: 0.3048 },
      { id: 'yd', label: 'Yard (yd)', toBase: 0.9144 },
      { id: 'mi', label: 'Mile (mi)', toBase: 1609.344 },
    ],
  },
  {
    id: 'mass', label: 'Mass',
    units: [
      { id: 'mg', label: 'Milligram (mg)', toBase: 1e-6 },
      { id: 'g', label: 'Gram (g)', toBase: 0.001 },
      { id: 'kg', label: 'Kilogram (kg)', toBase: 1 },
      { id: 't', label: 'Tonne (t)', toBase: 1000 },
      { id: 'oz', label: 'Ounce (oz)', toBase: 0.028349523125 },
      { id: 'lb', label: 'Pound (lb)', toBase: 0.45359237 },
      { id: 'st', label: 'Stone (st)', toBase: 6.35029318 },
    ],
  },
  {
    id: 'temperature', label: 'Temperature', temperature: true,
    units: [
      { id: 'c', label: 'Celsius (°C)', toBase: 1 },
      { id: 'f', label: 'Fahrenheit (°F)', toBase: 1 },
      { id: 'k', label: 'Kelvin (K)', toBase: 1 },
    ],
  },
  {
    id: 'data', label: 'Data',
    units: [
      { id: 'b', label: 'Byte (B)', toBase: 1 },
      { id: 'kb', label: 'Kilobyte (KB)', toBase: 1024 },
      { id: 'mb', label: 'Megabyte (MB)', toBase: 1024 ** 2 },
      { id: 'gb', label: 'Gigabyte (GB)', toBase: 1024 ** 3 },
      { id: 'tb', label: 'Terabyte (TB)', toBase: 1024 ** 4 },
    ],
  },
  {
    id: 'speed', label: 'Speed',
    units: [
      { id: 'mps', label: 'Meters/sec (m/s)', toBase: 1 },
      { id: 'kmh', label: 'Kilometers/hour (km/h)', toBase: 1 / 3.6 },
      { id: 'mph', label: 'Miles/hour (mph)', toBase: 0.44704 },
      { id: 'kn', label: 'Knot (kn)', toBase: 0.514444 },
      { id: 'fts', label: 'Feet/sec (ft/s)', toBase: 0.3048 },
    ],
  },
  {
    id: 'area', label: 'Area',
    units: [
      { id: 'cm2', label: 'Square cm (cm²)', toBase: 1e-4 },
      { id: 'm2', label: 'Square meter (m²)', toBase: 1 },
      { id: 'ha', label: 'Hectare (ha)', toBase: 1e4 },
      { id: 'km2', label: 'Square km (km²)', toBase: 1e6 },
      { id: 'ft2', label: 'Square foot (ft²)', toBase: 0.09290304 },
      { id: 'ac', label: 'Acre (ac)', toBase: 4046.8564224 },
    ],
  },
  {
    id: 'volume', label: 'Volume',
    units: [
      { id: 'ml', label: 'Milliliter (mL)', toBase: 0.001 },
      { id: 'l', label: 'Liter (L)', toBase: 1 },
      { id: 'm3', label: 'Cubic meter (m³)', toBase: 1000 },
      { id: 'tsp', label: 'Teaspoon (tsp)', toBase: 0.00492892159 },
      { id: 'tbsp', label: 'Tablespoon (tbsp)', toBase: 0.0147867648 },
      { id: 'cup', label: 'Cup (US)', toBase: 0.236588236 },
      { id: 'gal', label: 'Gallon (US)', toBase: 3.78541178 },
    ],
  },
  {
    id: 'time', label: 'Time',
    units: [
      { id: 's', label: 'Second (s)', toBase: 1 },
      { id: 'min', label: 'Minute (min)', toBase: 60 },
      { id: 'h', label: 'Hour (h)', toBase: 3600 },
      { id: 'd', label: 'Day (d)', toBase: 86400 },
      { id: 'wk', label: 'Week (wk)', toBase: 604800 },
      { id: 'yr', label: 'Year (yr)', toBase: 31557600 },
    ],
  },
];

export function convertUnits(value: number, from: UnitDef, to: UnitDef, category: UnitCategory): number {
  if (category.temperature) {
    let c: number;
    if (from.id === 'c') c = value;
    else if (from.id === 'f') c = ((value - 32) * 5) / 9;
    else c = value - 273.15;
    if (to.id === 'c') return c;
    if (to.id === 'f') return (c * 9) / 5 + 32;
    return c + 273.15;
  }
  return (value * from.toBase) / to.toBase;
}
