# Istruzioni per chi sviluppa (persone e strumenti AI)

- Lingua: interfaccia, messaggi di errore, commenti e documentazione in **italiano**. Testi brevi e concreti, rivolti a un apicoltore che usa l'app con le mani occupate.
- **Le regole stanno nel database.**
  - Permessi, blocchi e calcoli si scrivono in SQL (RLS, trigger, rpc), non nel frontend.
  - Il frontend può anticipare un controllo per dare un messaggio migliore, ma il database resta l'arbitro.
- Lo schema già rilasciato non si modifica: ogni cambiamento è un nuovo file in `supabase/migrations/` con data nel nome. Dopo ogni modifica i test in `supabase/test/` devono passare (vedi README).
- Tutte le chiamate a Supabase passano da `src/lib/api.ts`. Le schermate non importano `supabase-js` direttamente.
- Gli errori del database diventano frasi comprensibili in `src/lib/errors.ts`. Ogni nuovo vincolo (constraint) va aggiunto lì.
- Stili:
  - Nei componenti si usano solo le variabili semantiche di `src/styles/tokens.css` (`--color-*`, `--space-*`, `--radius-*`…), mai i colori scritti a mano.
  - Minimi da rispettare: 44 px per ciò che si tocca, 16 px per il testo base, contrasto AA anche nel tema scuro.
- Telefono e computer sono entrambi primari. Prima di consegnare, controlla ogni schermata a 390 px e a 1366 px, in tema chiaro e scuro. Non deve mai esserci scorrimento orizzontale.
- **Pochi campi per schermata.** I codici (lotti, SKU), gli scarichi di magazzino e i costi li calcola l'app, non li scrive l'utente.
- Niente segreti nel repository: la service_role key vive solo nella Edge Function, su Supabase.
