/**
 * Aggiornamento automatico: l'app installata sulla Home può restare aperta per giorni.
 * Quando su Cloudflare esce una versione nuova, l'app se ne accorge e si ricarica da sola
 * appena è sicuro farlo (riapertura o cambio pagina, senza modifiche non salvate).
 */
declare const __VERSIONE__: string;
export const VERSIONE = __VERSIONE__;

let nuova = false;
let ultimoControllo = 0;

/** true se sul server c'è una versione diversa da quella in uso */
export const versioneNuova = () => nuova;

export async function controllaVersione(forza = false): Promise<boolean> {
  if (nuova) return true;
  if (!import.meta.env.PROD || !navigator.onLine) return false;
  if (!forza && Date.now() - ultimoControllo < 60_000) return false;   // al massimo una volta al minuto
  ultimoControllo = Date.now();
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return false;
    const { v } = await r.json() as { v?: string };
    nuova = !!v && v !== VERSIONE;
  } catch { /* rete assente: si riprova più tardi */ }
  return nuova;
}

/** Ricarica l'app al percorso indicato prendendo la versione nuova. */
export function ricaricaConVersioneNuova(path = location.pathname + location.search) {
  location.assign(path);
}
