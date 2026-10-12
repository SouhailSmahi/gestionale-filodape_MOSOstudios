# Gestionale Filodape

Gestionale su misura per **Filodape** (Filippo Menossi, apicoltore, Bagnaria Arsa UD), sviluppato da **MOSO Studios**.
È il primo cliente reale e il caso studio della versione white-label di MOSO.

Copre:
- ordini, consegne, incassi e mercati;
- produzione a lotti (spostamenti, smielatura, confezionamento, chiusura);
- acquisti, i quattro magazzini e l'attrezzatura;
- il costo vero di ogni vasetto;
- l'andamento dell'attività.

Funziona da telefono (installabile come app) e da computer (browser).

| Pezzo | Dove | Costo |
|---|---|---|
| Database, accessi, funzioni server | Supabase (regione Frankfurt) | piano gratuito |
| App web (PWA) | Netlify, account separato dal sito filodape.it | piano gratuito |
| Codice, controlli automatici, keep-alive, backup | GitHub + Actions | gratuito |

Per mettere in linea l'app la prima volta: **[docs/RILASCIO.md](docs/RILASCIO.md)**.

---

## Come è fatto

**Le regole stanno nel database.**
- In Postgres ci sono permessi (Row Level Security), blocchi (giacenze negative, transizioni di stato degli ordini) e calcoli dei costi.
- L'app fa solo interfaccia e chiamate. Qualunque client si usi, le regole valgono uguali.

```
supabase/
  migrations/      schema completo (tabelle, funzioni, trigger, viste, RLS) + keep-alive
  functions/       Edge Function "gestione-utenti" (crea aiutanti, password, disattiva)
  test/            simulazione minima di Supabase + 60 test funzionali dello schema
src/
  main.ts          avvio: sessione, login, router
  app.ts           router con indirizzi veri, pila per il tasto "indietro", ciclo di disegno
  rotte.ts         elenco pagine e chi può aprirle
  lib/api.ts       UNICO punto di contatto con Supabase (tutte le query e le rpc)
  lib/errors.ts    traduce gli errori del database in frasi comprensibili
  lib/types.ts     tipi delle righe lette
  lib/catalogo.ts  prodotti in vendita (cache breve)
  lib/rif.ts       anagrafiche per i menu (cache breve)
  lib/bozze.ts     bozze dei moduli salvate sul dispositivo
  ui/              componenti (moduli, righe, badge, toast, finestre), grafici SVG, cornice
  screens/         una pagina per file
  styles/          tokens.css (design system, variante C) + app.css (componenti)
design/            direzione visiva C (PDF) e sorgenti dell'icona
```

### Scelte principali

- **Registri append-only.**
  - Ogni giacenza è la somma dei suoi movimenti: `movimenti_prodotto`, `movimenti_articoli`, `movimenti_miele`.
  - I movimenti non si modificano: le correzioni sono rettifiche con motivo.
- **Operazioni a più passi = una rpc atomica.** Sono `crea_comanda`, `registra_consegna`, `registra_acquisto`, `confeziona`, `chiudi_lotto` e le altre. Se un passo fallisce, non resta nulla a metà.
- **Costo del lotto congelato alla chiusura.**
  - Viene salvato in `lotti` e `lotti_costo_vasetti`.
  - Se in seguito cambiano acquisti, attrezzatura o impostazioni, `v_lotti.dati_cambiati` diventa vero e si ricalcola con `ricalcola_lotto()`.
- **Viste.**
  - Quelle per lo staff mostrano dati ridotti e hanno un filtro esplicito.
  - Quelle per il titolare sono `security_invoker`, quindi seguono le RLS.
- **Archiviazione invece di cancellazione.** Si cancella solo ciò che non è mai stato usato (sono le foreign key a impedirlo). Il resto si archivia.
- **Login con "nome.cognome".**
  - L'app lo trasforma nell'email tecnica `nome.cognome@utenti.filodape.it`.
  - La sessione resta aperta finché non si esce.
  - Gli aiutanti li gestisce la Edge Function, che è l'unica a usare la service_role.
- **Frontend leggero.**
  - Vite + TypeScript + [lit-html](https://lit.dev/docs/libraries/standalone-templates/) per i template, senza altri framework.
  - I font sono ospitati con l'app, senza Google Fonts, per velocità e privacy.
- **Design system.**
  - I componenti usano solo le variabili semantiche di `src/styles/tokens.css` (es. `--color-surface`), mai i colori scritti a mano.
  - Il tema scuro segue il dispositivo, oppure si sceglie in Impostazioni.

### Ruoli

| | Titolare (admin) | Aiutante (staff) |
|---|---|---|
| Nuovo ordine, i propri ordini, disponibilità | sì | sì |
| Conferma, consegna, incassi | sì | no |
| Produzione, magazzino, acquisti, mercato, attrezzatura, andamento | sì | no |
| Anagrafiche, prezzi, utenti, impostazioni | sì | no |

Gli aiutanti non vedono costi, telefoni dei clienti o ordini degli altri. Lo impedisce il database, non solo l'interfaccia.

---

## Sviluppo in locale

```bash
npm install
cp .env.example .env.local     # URL e chiave anon del progetto Supabase (anche uno di prova)
npm run dev                    # http://localhost:5173
npm run build                  # controllo dei tipi + build in dist/
```

Per un database locale completo serve la Supabase CLI con Docker: `supabase start`, poi `supabase db reset`.

In alternativa, lo schema si prova con un Postgres qualsiasi:
```bash
createdb filodape
psql -d filodape -f supabase/test/00_stub_supabase.sql
for f in supabase/migrations/*.sql; do psql -d filodape -f "$f"; done
psql -d filodape -f supabase/test/01_dati_demo.sql
psql -d filodape -f supabase/test/02_test_funzionali.sql     # tutte le righe devono iniziare con "ok"
```

Il workflow **Verifica** (`.github/workflows/verifica.yml`) ripete build e test a ogni pull request.

## Mappa schermata → database

| Schermata | Letture | Scritture |
|---|---|---|
| Nuovo ordine | `v_disponibilita_staff`, `v_clienti_staff` | `rpc crea_comanda` |
| I miei ordini | `v_mie_comande`, `comanda_righe` | `update comande` (annulla, finché in attesa) |
| Ordini / scheda ordine | `comande` + righe, pagamenti, consegne; `v_saldi_aperti` | `conferma_comanda`, `registra_consegna`, `insert movimenti_pagamento` |
| Home | `v_da_fare`, `v_notifiche_da_leggere`, `v_scadenze_consegna`, `v_lotti`… | `preferenze_home` |
| Produzione / lotto / tappe | `v_lotti`, `lotto_eventi`, `quota_stagione()`, `costo_km()` | `nuovo_lotto`, `registra_evento_lotto`, `confeziona`, `chiudi_lotto`, `ricalcola_lotto`, `registra_attivita` |
| Magazzino | `v_quadro_disponibilita`, `v_miele_sfuso`, `v_giacenza_articoli`, `v_costo_vasetti` | `rettifica_prodotto/articolo/miele`, `imposta_prezzo` |
| Acquisti | `acquisti` + righe | `registra_acquisto`, update/delete righe (il magazzino si compensa da solo) |
| Mercato | `sessioni_mercato` + righe | insert sessione e righe (prelievo), `chiudi_sessione_mercato` |
| Attrezzatura | `cespiti`, `uso_cespiti()` | insert/update `cespiti` |
| Andamento | `v_vendite`, `v_spese`, `smielatura_bariloni`, `v_lotti` | `grafici_utente` |
| Anagrafiche / articoli | tabelle anagrafiche | insert/update; delete se mai usato, altrimenti `archiviato` |
| Impostazioni | `profili`, `impostazioni` | Edge Function `gestione-utenti`, `impostazioni` |
