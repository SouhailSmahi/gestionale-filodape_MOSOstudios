-- Correzioni emerse dalla revisione dell'app (ottobre 2026).

-- 1. Gli aiutanti non riuscivano ad annullare i propri ordini: la notifica
--    leggeva new.comanda_id anche sulla tabella comande (che non ha quella colonna).
create or replace function fn_notifica_modifica_staff() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_comanda bigint; v_titolo text;
begin
    if not is_admin() and auth.uid() is not null then
        -- to_jsonb: le due tabelle hanno colonne diverse, così non si legge un campo che non c'è
        v_titolo := 'Ordine modificato dallo staff';
        if tg_table_name = 'comande' then
            v_comanda := new.id;
            if to_jsonb(new) ->> 'stato' = 'annullata' and to_jsonb(old) ->> 'stato' <> 'annullata' then
                v_titolo := 'Ordine annullato dallo staff';
            end if;
        else
            v_comanda := coalesce((to_jsonb(new) ->> 'comanda_id')::bigint, (to_jsonb(old) ->> 'comanda_id')::bigint);
        end if;
        if not exists (select 1 from notifiche where categoria = 'modifiche' and letta_il is null
                         and tabella_rif = 'comande' and record_rif = v_comanda::text and titolo = v_titolo) then
            insert into notifiche (categoria, titolo, messaggio, tabella_rif, record_rif, generata_da)
            select 'modifiche', v_titolo,
                   format('%s — comanda n. %s, da %s', coalesce(cl.nome || ' ' || cl.cognome, ''), v_comanda, p.username),
                   'comande', v_comanda::text, auth.uid()
              from profili p
              left join comande c on c.id = v_comanda
              left join clienti cl on cl.id = c.cliente_id
             where p.id = auth.uid();
        end if;
    end if;
    return coalesce(new, old);
end $$;

-- 2. Lo staff non può spostare un proprio ordine su un altro cliente.
create or replace function fn_protezione_comande() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then
        if tg_op = 'INSERT' then
            new.stato := 'in_attesa_conferma';
            new.data_consegna_indicativa := null;
            new.confermata_da := null;
            new.confermata_il := null;
            new.creata_da := auth.uid();
        else
            new.cliente_id := old.cliente_id;
            new.data_consegna_indicativa := old.data_consegna_indicativa;
            new.confermata_da := old.confermata_da;
            new.confermata_il := old.confermata_il;
            new.creata_da := old.creata_da;
        end if;
    end if;
    if tg_op = 'UPDATE' and new.stato <> old.stato and not (
           (old.stato = 'in_attesa_conferma' and new.stato in ('confermata', 'in_produzione', 'annullata'))
        or (old.stato = 'confermata'         and new.stato in ('in_produzione', 'parzialmente_evasa', 'evasa', 'annullata'))
        or (old.stato = 'in_produzione'      and new.stato in ('confermata', 'parzialmente_evasa', 'evasa', 'annullata'))
        or (old.stato = 'parzialmente_evasa' and new.stato = 'evasa')) then
        raise exception 'Passaggio di stato non ammesso: da % a %', old.stato, new.stato;
    end if;
    return new;
end $$;

-- 3. Lo staff ordina solo prodotti a catalogo (anche scrivendo direttamente le righe).
create or replace function fn_righe_solo_catalogo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() and not exists (select 1 from varianti_prodotto where id = new.variante_id and attivo) then
        raise exception 'Prodotto non disponibile a catalogo';
    end if;
    return new;
end $$;
create trigger trg_righe_solo_catalogo before insert or update of variante_id on comanda_righe
    for each row execute function fn_righe_solo_catalogo();

-- 4. motivo_id è un aiuto interno delle rettifiche (riservate al titolare): non si chiama da fuori.
revoke execute on function motivo_id(magazzino_rettifica, text) from public, anon, authenticated;

-- 5. Su Supabase le tabelle e funzioni create in futuro sarebbero concesse in automatico
--    anche a chi non ha fatto l'accesso: lo togliamo una volta per tutte.
--    (Ogni nuova tabella deve comunque avere RLS attiva: lo controlla il workflow Verifica.)
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
