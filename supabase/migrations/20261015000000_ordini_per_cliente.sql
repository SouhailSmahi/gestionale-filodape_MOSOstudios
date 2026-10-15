-- Ordini raggruppati per cliente (ottobre 2026).
-- Operazioni "in blocco" sugli ordini di uno stesso cliente: conferma, consegna e incasso.
-- Sono tutte "tutto o niente": se un ordine non si può confermare o consegnare, non cambia nulla.

-- 1. Conferma di più ordini con la stessa data (solo titolare)
create or replace function conferma_comande(p_comande bigint[], p_stato stato_comanda, p_data date)
returns int language plpgsql security definer set search_path = public as $$
declare c bigint; n int := 0;
begin
    if not is_admin() then raise exception 'Solo l''amministratore può confermare le comande'; end if;
    if coalesce(array_length(p_comande, 1), 0) = 0 then raise exception 'Scegli almeno un ordine da confermare'; end if;
    foreach c in array p_comande loop
        perform conferma_comanda(c, p_stato, p_data);
        n := n + 1;
    end loop;
    return n;
end $$;

-- 2. Incasso unico diviso sugli ordini: prima si salda il più vecchio.
--    Quello che avanza resta sull'ultimo ordine come acconto.
create or replace function distribuisci_incasso(p_comande bigint[], p_importo numeric, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record; resto numeric := round(p_importo, 2); quota numeric; ultimo bigint;
begin
    if not is_admin() then raise exception 'Solo l''amministratore registra gli incassi'; end if;
    if p_importo is null or p_importo <= 0 then raise exception 'Scrivi un importo maggiore di zero'; end if;
    for r in
        select c.id,
               coalesce((select sum(cr.quantita_evasa * coalesce(cr.prezzo_unitario_applicato, 0)) from comanda_righe cr where cr.comanda_id = c.id), 0)
             - coalesce((select sum(mp.importo) from movimenti_pagamento mp where mp.comanda_id = c.id), 0) as saldo
          from comande c
         where c.id = any(p_comande) and c.stato <> 'annullata'
         order by c.creata_il, c.id
    loop
        ultimo := r.id;
        quota := least(resto, greatest(r.saldo, 0));
        if quota > 0 then
            insert into movimenti_pagamento (comanda_id, importo, note) values (r.id, quota, coalesce(p_note, 'Incasso'));
            resto := resto - quota;
        end if;
    end loop;
    if ultimo is null then raise exception 'Nessun ordine valido per l''incasso'; end if;
    if resto > 0 then
        insert into movimenti_pagamento (comanda_id, importo, note) values (ultimo, resto, coalesce(p_note, 'Incasso') || ' (acconto)');
    end if;
end $$;

-- 3. Consegna di tutto ciò che resta da consegnare negli ordini scelti, più l'eventuale incasso.
--    Se manca merce per un prodotto, si ferma tutto con un messaggio che dice cosa manca.
create or replace function consegna_comande(p_comande bigint[], p_incasso numeric default null, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare c record; n int := 0; manca text;
begin
    if not is_admin() then raise exception 'Solo l''amministratore registra le consegne'; end if;
    if coalesce(array_length(p_comande, 1), 0) = 0 then raise exception 'Scegli almeno un ordine da consegnare'; end if;

    -- controllo preventivo: un solo messaggio con tutto quello che manca
    select string_agg(format('%s: servono %s, pronti %s', v.codice_articolo, x.serve, coalesce(g.disp, 0)), '; ' order by v.codice_articolo)
      into manca
      from (select cr.variante_id, sum(cr.quantita_ordinata - cr.quantita_evasa) as serve
              from comanda_righe cr join comande co on co.id = cr.comanda_id
             where co.id = any(p_comande) and co.stato in ('confermata', 'in_produzione', 'parzialmente_evasa')
             group by cr.variante_id having sum(cr.quantita_ordinata - cr.quantita_evasa) > 0) x
      join varianti_prodotto v on v.id = x.variante_id
      left join (select variante_id, sum(quantita) as disp from movimenti_prodotto group by variante_id) g on g.variante_id = x.variante_id
     where x.serve > coalesce(g.disp, 0);
    if manca is not null then
        raise exception 'Merce pronta insufficiente (%). Consegna gli ordini uno per uno o produci prima.', manca;
    end if;

    for c in select co.id from comande co
              where co.id = any(p_comande) and co.stato in ('confermata', 'in_produzione', 'parzialmente_evasa')
              order by co.creata_il, co.id loop
        perform registra_consegna(c.id,
            (select jsonb_agg(jsonb_build_object('comanda_riga_id', cr.id, 'quantita', cr.quantita_ordinata - cr.quantita_evasa))
               from comanda_righe cr where cr.comanda_id = c.id and cr.quantita_evasa < cr.quantita_ordinata),
            p_note);
        n := n + 1;
    end loop;
    if n = 0 then raise exception 'Nessuno degli ordini scelti è da consegnare'; end if;

    if p_incasso is not null and p_incasso > 0 then
        perform distribuisci_incasso(p_comande, p_incasso, 'Incasso alla consegna');
    end if;
    return n;
end $$;

-- 4. Aggiunta di prodotti a un ordine ancora in attesa (aiutante che l'ha inserito, oppure titolare).
--    Se il prodotto c'è già nell'ordine, si sommano i pezzi.
create or replace function aggiungi_a_comanda(p_comanda bigint, p_righe jsonb, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record; co comande%rowtype;
begin
    if not is_utente_attivo() then raise exception 'Utente non attivo'; end if;
    select * into co from comande where id = p_comanda for update;
    if not found then raise exception 'Ordine non trovato'; end if;
    if not is_admin() and co.creata_da is distinct from auth.uid() then raise exception 'Puoi aggiungere prodotti solo ai tuoi ordini'; end if;
    if co.stato <> 'in_attesa_conferma' then raise exception 'L''ordine è già stato confermato: inserisci un ordine nuovo'; end if;
    if jsonb_array_length(coalesce(p_righe, '[]')) = 0 then raise exception 'Aggiungi almeno un prodotto'; end if;
    for r in select (e->>'variante_id')::int as variante_id, sum((e->>'quantita')::int) as qta
               from jsonb_array_elements(p_righe) e group by 1 loop
        if coalesce(r.qta, 0) <= 0 then raise exception 'Scrivi quanti pezzi (almeno 1)'; end if;
        if not exists (select 1 from varianti_prodotto where id = r.variante_id and attivo) then
            raise exception 'Prodotto non disponibile a catalogo';
        end if;
        update comanda_righe set quantita_ordinata = quantita_ordinata + r.qta
         where comanda_id = p_comanda and variante_id = r.variante_id;
        if not found then
            insert into comanda_righe (comanda_id, variante_id, quantita_ordinata) values (p_comanda, r.variante_id, r.qta);
        end if;
    end loop;
    if coalesce(trim(p_note), '') <> '' then
        update comande set note = concat_ws(' · ', nullif(note, ''), trim(p_note)) where id = p_comanda;
    end if;
end $$;

revoke execute on function conferma_comande(bigint[], stato_comanda, date), distribuisci_incasso(bigint[], numeric, text),
    consegna_comande(bigint[], numeric, text), aggiungi_a_comanda(bigint, jsonb, text) from public, anon;
grant execute on function conferma_comande(bigint[], stato_comanda, date), distribuisci_incasso(bigint[], numeric, text),
    consegna_comande(bigint[], numeric, text), aggiungi_a_comanda(bigint, jsonb, text) to authenticated;

-- 5. Gli aiutanti vedono a quale cliente appartiene ogni loro ordine (serve per raggrupparli)
create or replace view v_mie_comande as
select c.id, c.creata_il, c.creata_da, cl.nome || ' ' || cl.cognome as cliente, c.stato,
       c.data_consegna_indicativa, c.note,
       string_agg(v.codice_articolo || ' ×' || cr.quantita_ordinata, ', ' order by v.codice_articolo) as articoli,
       c.cliente_id
  from comande c
  join clienti cl on cl.id = c.cliente_id
  left join comanda_righe cr on cr.comanda_id = c.id
  left join varianti_prodotto v on v.id = cr.variante_id
 where is_utente_attivo() and (c.creata_da = auth.uid() or is_admin())
 group by c.id, cl.nome, cl.cognome;
revoke all on v_mie_comande from anon;
grant select on v_mie_comande to authenticated;
