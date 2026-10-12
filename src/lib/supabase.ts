import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !key) {
  // Messaggio leggibile invece di una pagina bianca se manca la configurazione
  document.body.innerHTML =
    '<p style="font:16px/1.5 system-ui;padding:24px">Configurazione mancante: imposta VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (vedi .env.example).</p>';
  throw new Error('Configurazione Supabase mancante');
}

/** Client unico. La sessione resta salvata sul dispositivo finché l'utente non esce. */
export const sb = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'filodape-auth',
  },
});

export const LOGIN_DOMAIN = (import.meta.env.VITE_LOGIN_DOMAIN as string | undefined) || 'utenti.filodape.it';
export const FUNCTIONS_URL = `${url.replace(/\/$/, '')}/functions/v1`;
