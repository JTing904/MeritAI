// Host names are shown in their ASCII (punycode) form, so a look-alike like 「аpple.com」 (Cyrillic а)
// reads as xn--pple-43d.com instead of passing for apple.com. RFC 3492 encoder; React Native has no URL.hostname.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

const digit = (d: number) => String.fromCharCode(d + (d < 26 ? 97 : 22)); // 0-25 a-z, 26-35 0-9

function adapt(delta: number, points: number, first: boolean): number {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) >> 1) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

function encodeLabel(label: string): string {
  const input = Array.from(label, (ch) => ch.codePointAt(0)!);
  let out = input.filter((c) => c < 0x80).map((c) => String.fromCharCode(c)).join('');
  const basic = out.length;
  let handled = basic;
  if (basic > 0) out += '-';
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < input.length) {
    const m = Math.min(...input.filter((c) => c >= n));
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of input) {
      if (c < n) delta++;
      if (c !== n) continue;
      let q = delta;
      for (let k = BASE; ; k += BASE) {
        const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
        if (q < t) break;
        out += digit(t + ((q - t) % (BASE - t)));
        q = Math.floor((q - t) / (BASE - t));
      }
      out += digit(q);
      bias = adapt(delta, handled + 1, handled === basic);
      delta = 0;
      handled++;
    }
    delta++;
    n++;
  }
  return `xn--${out}`;
}

/** 例子.测试 → xn--fsqu00a.xn--0zwm56d; ASCII labels stay as they are (lower-cased). */
export function toAsciiHost(host: string): string {
  return host
    .normalize('NFC')
    .toLowerCase()
    .split(/[.。．｡]/)
    .map((label) => (/^[\x00-\x7f]*$/.test(label) ? label : encodeLabel(label)))
    .join('.');
}
