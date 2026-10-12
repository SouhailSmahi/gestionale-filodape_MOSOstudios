// Edge Function "gestione-utenti": solo il titolare (ruolo admin) può creare aiutanti,
// impostare una nuova password o disattivare/riattivare un accesso.
// Usa la service_role key, che esiste solo qui sul server: non va MAI messa nell'app.
//
// Rilascio:  supabase functions deploy gestione-utenti
// Variabili:  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (fornite da Supabase)
//             LOGIN_DOMAIN (facoltativa, predefinita utenti.filodape.it)
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const risposta = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const URL_ = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DOMINIO = Deno.env.get('LOGIN_DOMAIN') ?? 'utenti.filodape.it';
const USERNAME = /^[a-z0-9]+(\.[a-z0-9]+)+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return risposta(405, { error: 'Metodo non consentito' });

  // 1. chi chiama? (con il suo token, rispettando le regole del database)
  const auth = req.headers.get('Authorization') ?? '';
  const utente = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await utente.auth.getUser();
  if (!u?.user) return risposta(401, { error: 'Accesso scaduto: entra di nuovo.' });
  const { data: me } = await utente.from('profili').select('ruolo, attivo').eq('id', u.user.id).maybeSingle();
  if (!me || me.ruolo !== 'admin' || !me.attivo) return risposta(403, { error: 'Operazione riservata al titolare.' });

  // 2. operazione con i permessi di servizio
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return risposta(400, { error: 'Richiesta non valida' }); }

  switch (b.azione) {
    case 'crea_utente': {
      const username = String(b.username ?? '').trim().toLowerCase();
      const nome = String(b.nome ?? '').trim(), cognome = String(b.cognome ?? '').trim(), password = String(b.password ?? '');
      if (!USERNAME.test(username)) return risposta(400, { error: 'Il nome utente va scritto come nome.cognome, minuscolo e senza spazi.' });
      if (!nome || !cognome) return risposta(400, { error: 'Servono nome e cognome.' });
      if (password.length < 8) return risposta(400, { error: 'La password deve avere almeno 8 caratteri.' });
      const { data: c, error } = await admin.auth.admin.createUser({ email: `${username}@${DOMINIO}`, password, email_confirm: true });
      if (error) return risposta(400, { error: /already|registered|exists/i.test(error.message) ? 'Esiste già un utente con questo nome utente.' : error.message });
      const { error: e2 } = await admin.from('profili').insert({ id: c.user.id, username, nome, cognome, ruolo: 'staff' });
      if (e2) { await admin.auth.admin.deleteUser(c.user.id); return risposta(400, { error: e2.message }); }
      return risposta(200, { id: c.user.id });
    }
    case 'reset_password': {
      const id = String(b.user_id ?? ''), password = String(b.password ?? '');
      if (password.length < 8) return risposta(400, { error: 'La password deve avere almeno 8 caratteri.' });
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      return error ? risposta(400, { error: error.message }) : risposta(200, { ok: true });
    }
    case 'imposta_attivo': {
      const id = String(b.user_id ?? ''), attivo = !!b.attivo;
      if (id === u.user.id) return risposta(400, { error: 'Non puoi disattivare te stesso.' });
      const { error } = await admin.from('profili').update({ attivo }).eq('id', id);
      if (error) return risposta(400, { error: error.message });
      // chi è disattivato perde subito anche le sessioni aperte (le regole del database lo bloccano comunque)
      if (!attivo) await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' });
      else await admin.auth.admin.updateUserById(id, { ban_duration: 'none' });
      return risposta(200, { ok: true });
    }
    default:
      return risposta(400, { error: 'Azione sconosciuta' });
  }
});
