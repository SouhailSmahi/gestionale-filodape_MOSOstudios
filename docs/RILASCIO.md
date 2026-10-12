# Messa in linea, passo per passo

Una volta sola. In tutto servono circa 45 minuti. Le chiavi e le password non vanno mai scritte in chat, né nel codice.

## 1. Database (Supabase)

1. **Regione e ruoli.** Il progetto deve essere in **Europa (Frankfurt)**. Va in *Project Settings → General*.
2. **Niente iscrizioni libere.** In *Authentication → Sign In / Providers* disattiva **"Allow new users to sign up"**.
   - Gli accessi li crea solo Filippo dall'app.
   - Anche se qualcuno si iscrivesse, non vedrebbe nulla, perché senza profilo il database non mostra dati. Ma è meglio chiudere la porta.
3. **Carica lo schema.** In *SQL Editor → New query* incolla ed esegui, nell'ordine:
   1. `supabase/migrations/20261001000000_schema_v03.sql`
   2. `supabase/migrations/20261012000000_ping_keepalive.sql`

   In alternativa, con la CLI: `supabase link --project-ref <ref>` e poi `supabase db push`.
4. **Accesso di Filippo.**
   1. In *Authentication → Users → Add user* inserisci l'email `filippo.menossi@utenti.filodape.it`. Scegli una password e spunta *Auto Confirm User*.
   2. Copia l'**User UID** e nel SQL Editor esegui:
      ```sql
      insert into profili (id, username, nome, cognome, ruolo)
      values ('<User UID>', 'filippo.menossi', 'Filippo', 'Menossi', 'admin');
      ```
5. **Funzione per gli utenti.**
   - Da *Edge Functions → Deploy a new function → Via Editor*: nome `gestione-utenti`, incolla `supabase/functions/gestione-utenti/index.ts` e fai **Deploy**.
   - Con la CLI: `supabase functions deploy gestione-utenti`.
6. **Chiavi da annotare** (*Project Settings → API*, oppure *Connect*):
   - **Project URL**: `https://xxxx.supabase.co`;
   - **anon / publishable key**: è pubblica per natura, perché a proteggere i dati sono le regole RLS;
   - **Database connection string**, versione *Session pooler*, con la password del database: serve solo per il backup.

## 2. GitHub (servizi automatici)

In *Settings → Secrets and variables → Actions → New repository secret* aggiungi:

| Nome | Valore |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_DB_URL` | connection string *Session pooler* (con la password) |
| `BACKUP_PASSPHRASE` | una frase lunga a piacere, **da conservare anche fuori da GitHub**: senza, i backup non si aprono |

Poi in *Actions* lancia a mano **Keep-alive Supabase** e **Backup notturno** (*Run workflow*). Devono finire in verde.
- **Keep-alive** gira ogni 2 giorni e impedisce che Supabase metta in pausa il progetto dopo 7 giorni di inattività.
- **Backup** gira ogni notte e conserva 30 giorni di copie cifrate.

## 3. App (Netlify)

1. Crea un account Netlify **nuovo**, separato da quello del sito filodape.it.
   - Il piano gratuito ha 300 crediti al mese, condivisi tra i siti dello stesso account.
   - Ogni pubblicazione ne consuma 15. Se i crediti finiscono, si fermano tutti i siti dell'account.
2. *Add new site → Import an existing project → GitHub* e scegli questo repository. Branch di pubblicazione: **main**. Il resto lo legge da `netlify.toml`.
3. In *Site configuration → Environment variables* aggiungi:
   - `VITE_SUPABASE_URL`: Project URL;
   - `VITE_SUPABASE_ANON_KEY`: anon key;
   - `VITE_LOGIN_DOMAIN`: `utenti.filodape.it`.
4. Per risparmiare crediti, in *Site configuration → Build & deploy*:
   - disattiva le **Deploy Previews** sulle pull request;
   - lascia la pubblicazione automatica solo per `main`.
5. **Deploy**, poi apri l'indirizzo e prova l'accesso di Filippo. Il nome del sito si cambia in *Domain management*, es. `gestionale-filodape.netlify.app`.

## 4. Primo avvio con Filippo (dati iniziali)

Va fatto insieme, dal computer, in quest'ordine:

1. **Impostazioni → Utenti**: crea gli aiutanti con "+ Nuovo aiutante" e comunica a ognuno la password, che potrà cambiare.
2. **Anagrafiche → Postazioni**: i luoghi reali, con km abituali andata e ritorno e numero di arnie.
3. **Anagrafiche → Mezzi**: controlla il Fiorino (dedicato), l'auto personale (tariffa al km) e il furgone dell'amico.
4. **Anagrafica articoli**: controlla vasetti, tappi, etichette e sigilli già presenti; aggiungi mangimi, candito e trattamenti con le loro confezioni e le scorte minime.
5. **Inventario iniziale dei materiali**: in *Acquisti → Nuovo acquisto*, fornitore "Inventario iniziale", inserisci quello che c'è in casa con un valore indicativo. Così ogni articolo parte con giacenza e costo.
6. **Vasetti già pronti**: in *Magazzino → Pronti → Rettifica*, con il motivo "Correzione inventario".
7. **Attrezzatura**: arnie, smielatore, maturatori, attrezzi, con anno, prezzo indicativo, contributo e vita utile.
8. **Prezzi**: *Magazzino → Prezzi e costi → Prezzo*. Quelli non ancora decisi restano "prezzo X".
9. **Lotti in corso**: *Produzione → Nuovo lotto*, poi le tappe già fatte, con la data giusta.

## 5. Periodo di prova (2–3 settimane)

- Filippo usa l'app e, in parallelo, continua con il suo Excel.
- Ogni settimana confrontate giacenze, incassi e ordini. Se c'è una differenza, si trova la causa prima di abbandonare l'Excel.
- Segnate le frasi poco chiare e i passaggi lenti: sono le prime modifiche da fare.

## Aggiornamenti successivi

- Codice: una pull request su `main`; il workflow **Verifica** deve essere verde. Al merge, Netlify ripubblica da solo.
- Database: **non** si modifica il file di schema già caricato. Si aggiunge un nuovo file in `supabase/migrations/` (es. `20261120000000_descrizione.sql`) e lo si esegue nel SQL Editor (o `supabase db push`).

## Backup e ripristino

Ogni notte GitHub salva un file `filodape-AAAA-MM-GG.tar.gz.gpg` tra gli *artifact* del workflow **Backup notturno**, conservato per 30 giorni.

Per ripristinare, su un computer con PostgreSQL 17 installato:

```bash
gpg --decrypt filodape-AAAA-MM-GG.tar.gz.gpg > backup.tar.gz     # chiede la BACKUP_PASSPHRASE
tar xzf backup.tar.gz
# su un progetto Supabase NUOVO e vuoto (connection string del nuovo progetto):
pg_restore --no-owner --no-privileges -d "<connection string>" auth_users.dump
pg_restore --no-owner --no-privileges -d "<connection string>" public.dump
```

Fai una prova di ripristino su un progetto di test almeno una volta, appena finito il periodo di prova: un backup mai provato non è un backup.

## Se qualcosa non va

| Sintomo | Causa probabile |
|---|---|
| Pagina bianca con "Configurazione mancante" | Mancano le variabili `VITE_…` su Netlify: aggiungile e ripubblica |
| "Nome utente o password non corretti" con dati giusti | L'utente non ha "Auto Confirm", oppure l'email non è `nome.cognome@utenti.filodape.it` |
| L'utente entra ma vede "accesso disattivato" | Manca la riga in `profili`, oppure `attivo = false` |
| "Operazione sugli utenti non riuscita" | La Edge Function `gestione-utenti` non è pubblicata |
| Supabase in pausa | Il keep-alive non gira: controlla i segreti su GitHub |
