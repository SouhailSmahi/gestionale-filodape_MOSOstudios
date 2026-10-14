import { svg, html } from 'lit-html';

/** Icone a tratto, disegnate per l'app (24×24, colore = testo). */
const P: Record<string, ReturnType<typeof svg>> = {
  home: svg`<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>`,
  ordini: svg`<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>`,
  produzione: svg`<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>`,
  magazzino: svg`<path d="M8 4h8v3H8z"/><path d="M7 7h10a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a1 1 0 0 1 1-1z"/><path d="M6 12h12"/>`,
  altro: svg`<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>`,
  piu: svg`<path d="M12 5v14M5 12h14"/>`,
  lista: svg`<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>`,
  campana: svg`<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>`,
  spunta: svg`<path d="m5 12.5 4.5 4.5L19 7"/>`,
  orologio: svg`<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l3 2"/>`,
  x: svg`<path d="m6 6 12 12M18 6 6 18"/>`,
  mezzo: svg`<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>`,
  ingranaggio: svg`<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>`,
  persona: svg`<circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/>`,
  freccia: svg`<path d="M15 5 8 12l7 7"/>`,
  avanti: svg`<path d="m9 5 7 7-7 7"/>`,
  su: svg`<path d="m6 15 6-6 6 6"/>`,
  giu: svg`<path d="m6 9 6 6 6-6"/>`,
  allerta: svg`<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.5"/>`,
  esci: svg`<path d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12H9"/>`,
  occhio: svg`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>`,
  matita: svg`<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>`,
  cestino: svg`<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>`,
  grafico: svg`<path d="M4 20V4M4 20h16"/><path d="m7 15 4-5 3 3 5-7"/>`,
};

export const icon = (name: keyof typeof P | string, label?: string) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden=${label ? 'false' : 'true'} role=${label ? 'img' : 'presentation'}>${label ? svg`<title>${label}</title>` : ''}${P[name] ?? P.altro}</svg>`;
