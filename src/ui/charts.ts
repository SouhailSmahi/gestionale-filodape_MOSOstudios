/**
 * Grafici SVG leggeri (linee, barre raggruppate, barre orizzontali).
 * Valori al passaggio del dito/mouse e tabella "Mostra i valori" per chi non legge il grafico.
 * Colori solo da token: --chart-1/2/3.
 */
import { html, svg, nothing, type TemplateResult } from 'lit-html';
import { ref } from 'lit-html/directives/ref.js';
import { aggiorna } from '../app';

export interface Serie { nome: string; valori: (number | null)[]; tratteggio?: boolean }
const CLS = ['s1', 's2', 's3'];
const hover = new Map<string, number | null>();

/** larghezza misurata di ogni grafico: il disegno usa i pixel veri, così il testo resta della sua misura */
const misure = new Map<string, number>();
addEventListener('resize', () => aggiorna());
function larghezza(id: string) { return misure.get(id) ?? Math.min(innerWidth - 80, 560); }
const misura = (id: string) => ref((el?: Element) => {
  if (!el) return;
  const w = Math.round(el.clientWidth);
  if (w > 0 && Math.abs((misure.get(id) ?? 0) - w) > 4) { misure.set(id, w); aggiorna(); }
});

function scala(max: number) {
  if (max <= 0) return { max: 1, passi: [0, 1] };
  const e = 10 ** Math.floor(Math.log10(max)), f = max / e;
  const step = (f <= 1.5 ? 0.25 : f <= 3 ? 0.5 : f <= 6 ? 1 : 2) * e;
  const top = Math.ceil(max / step) * step;
  const passi: number[] = []; for (let v = 0; v <= top + step / 2; v += step) passi.push(v);
  return { max: top, passi };
}

export function legenda(serie: { nome: string; tratteggio?: boolean }[], linee = false) {
  return html`<div class="legend">${serie.map((s, i) => html`<span><i class="${linee ? 'ln' : ''} ${s.tratteggio ? 'dash' : ''}"
    style="background:var(--chart-${i + 1});color:var(--chart-${i + 1})"></i>${s.nome}</span>`)}</div>`;
}

export function tabellaValori(etichette: string[], serie: Serie[], fmt: (v: number) => string) {
  return html`<details class="more"><summary>Mostra i valori</summary><div class="table-wrap"><table class="t">
    <thead><tr><th></th>${serie.map((s) => html`<th class="r">${s.nome}</th>`)}</tr></thead>
    <tbody>${etichette.map((e, i) => html`<tr><td>${e}</td>${serie.map((s) => html`<td class="r">${s.valori[i] == null ? '—' : fmt(s.valori[i]!)}</td>`)}</tr>`)}</tbody>
  </table></div></details>`;
}

/** Linee nel tempo (es. mesi). `fmtAsse` per le etichette brevi dell'asse, `fmt` per il valore esatto. */
export function grafLinee(id: string, etichette: string[], serie: Serie[], fmt: (v: number) => string, fmtAsse = fmt): TemplateResult {
  const W = larghezza(id), H = W < 400 ? 220 : 260, L = W < 400 ? 56 : 68, R = 12, T = 12, B = 28;
  const vals = serie.flatMap((s) => s.valori.filter((v): v is number => v != null));
  if (!vals.length) return html`<p class="chart-empty">Ancora nessun dato da mostrare.</p>`;
  const { max, passi } = scala(Math.max(...vals));
  const n = etichette.length, x = (i: number) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1)), y = (v: number) => T + (H - T - B) * (1 - v / max);
  const h = hover.get(id) ?? null;
  const ogni = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L) / 46))));
  const muovi = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
    if (hover.get(id) !== i) { hover.set(id, i); aggiorna(); }
  };
  const tip = h != null ? serie.map((s, k) => ({ s, k, v: s.valori[h] })).filter((o) => o.v != null) : [];
  return html`<div class="chart" ${misura(id)}>
    ${legenda(serie, true)}
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label=${`Grafico: ${serie.map((s) => s.nome).join(', ')}`}
      @pointermove=${muovi} @pointerdown=${muovi} @pointerleave=${() => { hover.set(id, null); aggiorna(); }}>
      ${passi.map((p) => svg`<line class="grid" x1=${L} x2=${W - R} y1=${y(p)} y2=${y(p)}></line>
        <text x=${L - 8} y=${y(p) + 4} text-anchor="end">${fmtAsse(p)}</text>`)}
      ${etichette.map((e, i) => i % ogni ? nothing : svg`<text x=${x(i)} y=${H - 8} text-anchor="middle">${e}</text>`)}
      ${serie.map((s, k) => {
        let d = '', su = false;
        s.valori.forEach((v, i) => { if (v == null) { su = false; return; } d += `${su ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; su = true; });
        return svg`<path class="line ${CLS[k]} ${s.tratteggio ? 'dash' : ''}" d=${d}></path>`;
      })}
      ${h != null ? svg`<line class="cursor" x1=${x(h)} x2=${x(h)} y1=${T} y2=${H - B}></line>
        ${tip.map((o) => svg`<circle class="marker ${CLS[o.k]}" cx=${x(h)} cy=${y(o.v!)} r="5"></circle>`)}` : nothing}
      <rect class="hit" x=${L} y=${T} width=${W - L - R} height=${H - T - B}></rect>
    </svg>
    ${h != null && tip.length ? html`<div class="tip" style="left:${(x(h) / W) * 100}%;top:${(y(Math.max(...tip.map((o) => o.v!))) / H) * 100}%">
      ${etichette[h]}${tip.map((o) => html`<b>${serie.length > 1 ? `${o.s.nome}: ` : ''}${fmt(o.v!)}</b>`)}</div>` : nothing}
    ${tabellaValori(etichette, serie, fmt)}
  </div>`;
}

/** Barre verticali raggruppate (es. anni × tipo di miele), con il valore scritto sopra. */
export function grafBarre(id: string, etichette: string[], serie: Serie[], fmt: (v: number) => string, fmtAsse = fmt): TemplateResult {
  const W = larghezza(id), H = W < 400 ? 230 : 270, L = W < 400 ? 50 : 64, R = 8, T = 22, B = 28;
  const vals = serie.flatMap((s) => s.valori.filter((v): v is number => v != null));
  if (!vals.length) return html`<p class="chart-empty">Ancora nessun dato da mostrare.</p>`;
  const { max, passi } = scala(Math.max(...vals));
  const n = etichette.length, gw = (W - L - R) / n, bw = Math.min(36, (gw * 0.75) / serie.length);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const h = hover.get(id) ?? null;
  const scriviValori = serie.length * n <= 12;
  return html`<div class="chart" ${misura(id)}>
    ${serie.length > 1 ? legenda(serie) : nothing}
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label=${`Grafico a barre: ${serie.map((s) => s.nome).join(', ')}`}
      @pointerleave=${() => { hover.set(id, null); aggiorna(); }}>
      ${passi.map((p) => svg`<line class="grid" x1=${L} x2=${W - R} y1=${y(p)} y2=${y(p)}></line>
        <text x=${L - 8} y=${y(p) + 4} text-anchor="end">${fmtAsse(p)}</text>`)}
      ${etichette.map((e, i) => {
        const x0 = L + i * gw + (gw - bw * serie.length) / 2;
        return svg`<g @pointerenter=${() => { hover.set(id, i); aggiorna(); }} @pointerdown=${() => { hover.set(id, i); aggiorna(); }}>
          <rect class="hit" x=${L + i * gw} y=${T} width=${gw} height=${H - T - B}></rect>
          ${serie.map((s, k) => { const v = s.valori[i]; if (v == null || v <= 0) return nothing;
            return svg`<rect class=${CLS[k]} x=${x0 + k * bw} y=${y(v)} width=${bw - 2} height=${H - B - y(v)} rx="2"></rect>
            ${scriviValori || h === i ? svg`<text x=${x0 + k * bw + bw / 2 - 1} y=${y(v) - 5} text-anchor="middle" style="font-weight:700;fill:var(--color-text)">${fmtAsse(v)}</text>` : nothing}`; })}
          <text x=${L + i * gw + gw / 2} y=${H - 8} text-anchor="middle">${e}</text></g>`;
      })}
    </svg>
    ${tabellaValori(etichette, serie, fmt)}
  </div>`;
}

/** Barre orizzontali con etichetta e valore scritti (es. spese per categoria). */
export function grafOrizzontale(voci: { l: string; v: number }[], fmt: (v: number) => string): TemplateResult {
  if (!voci.length) return html`<p class="chart-empty">Ancora nessun dato da mostrare.</p>`;
  const max = Math.max(...voci.map((x) => x.v), 1);
  return html`<div class="hbars">${voci.map((x) => html`<div class="hb"><span class="lab">${x.l}</span><span class="val">${fmt(x.v)}</span>
    <span class="bar" style="width:${Math.max(1, (x.v / max) * 100)}%"></span></div>`)}</div>`;
}
