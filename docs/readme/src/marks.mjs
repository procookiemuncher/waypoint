// Small marks that sit straight on GitHub's page: the Leap divider (a ring where it starts, a dot
// where it lands, one line between) in a dark-page and a light-page version, and the platform
// pills under the hero.
import { text, measure, svgDoc, write, T, n1 } from './svgkit.mjs';

// ---- divider ----
{
  const W = 1800, H = 36, cy = H / 2;
  for (const [name, line, mark] of [['divider-dark.svg', '#30363d', T.accent], ['divider-light.svg', '#d0d7de', T.deep]]) {
    const r = 9, x0 = W / 2 - 260, x1 = W / 2 + 260;
    const body =
      `<path d="M${x0 + r + 14} ${cy}H${x1 - r * 1.3 - 14}" stroke="${line}" stroke-width="3" stroke-linecap="round"/>` +
      `<circle cx="${x0}" cy="${cy}" r="${r}" fill="none" stroke="${mark}" stroke-width="${n1(r * 0.78)}"/>` +
      `<circle cx="${x1}" cy="${cy}" r="${n1(r * 1.3)}" fill="${mark}"/>`;
    write(name, svgDoc(W, H, body, { title: 'divider' }));
  }
}

// ---- platform pills ----
{
  const items = ['macOS', 'Windows', 'Python 3.12–3.13', 'iOS 17+'];
  const F = { size: 26, weight: 500, tracking: -0.005 };
  const ph = 52, padX = 24, dotGap = 16, gap = 14;
  const widths = items.map(t => measure(t, F) + padX * 2 + dotGap);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
  const W = Math.ceil(total) + 4, H = ph + 4;   // cropped to the pills, so a phone shows them big enough
  let x = 2, body = '';
  items.forEach((t, i) => {
    const w = widths[i];
    body += `<rect x="${n1(x)}" y="2" width="${n1(w)}" height="${ph}" rx="${ph / 2}" fill="${T.raised}"/>`;
    body += `<circle cx="${n1(x + padX + 3)}" cy="${2 + ph / 2}" r="5" fill="${T.accent}"/>`;
    body += text(t, { ...F, x: x + padX + dotGap, y: 2 + ph / 2 + 9.5, color: T.ink2 });
    x += w + gap;
  });
  write('badges.svg', svgDoc(W, H, body, { title: items.join(' · ') }));
}
