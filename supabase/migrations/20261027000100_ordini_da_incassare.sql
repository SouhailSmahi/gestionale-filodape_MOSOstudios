-- Soldi ancora da incassare sugli ordini aperti (ottobre 2026), per la Home del titolare.
-- Per ogni ordine non annullato: valore dell'ordine meno quanto già incassato (acconti compresi).
-- Un ordine pagato del tutto non conta più. Vale per tutti gli anni.
create view v_ordini_da_incassare with (security_invoker = true) as
with o as (
    select c.id, c.stato,
           sum(cr.quantita_ordinata * coalesce(cr.prezzo_unitario_applicato, 0)) as totale,
           sum(cr.quantita_ordinata) filter (where cr.prezzo_unitario_applicato is null) as senza_prezzo,
           coalesce((select sum(mp.importo) from movimenti_pagamento mp where mp.comanda_id = c.id), 0) as incassato
      from comande c join comanda_righe cr on cr.comanda_id = c.id
     where c.stato <> 'annullata' and is_admin()
     group by c.id, c.stato
), aperti as (
    select *, totale - incassato as manca from o
     where totale - incassato > 0 or (stato <> 'evasa' and senza_prezzo > 0)
)
select count(*)::int as ordini,
       coalesce(sum(greatest(manca, 0)), 0)::numeric(12,2) as totale,
       coalesce(sum(greatest(manca, 0)) filter (where stato = 'in_attesa_conferma'), 0)::numeric(12,2) as da_confermare,
       coalesce(sum(greatest(manca, 0)) filter (where stato in ('confermata', 'in_produzione', 'parzialmente_evasa')), 0)::numeric(12,2) as da_consegnare,
       coalesce(sum(greatest(manca, 0)) filter (where stato = 'evasa'), 0)::numeric(12,2) as consegnati,
       coalesce(sum(senza_prezzo), 0)::int as pezzi_senza_prezzo
  from aperti;
grant select on v_ordini_da_incassare to authenticated;
