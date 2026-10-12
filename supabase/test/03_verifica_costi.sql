set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) \g /dev/null
select codice, stato, kg_smielati, kg_sfuso, kg_calo, kg_uso_personale, round(costo_kg_congelato,4) cong, round(costo_kg_attuale,4) att, dati_cambiati from v_lotti order by id;
select round(costo_km(2026,1),4) fiorino26, round(costo_km(2025,1),4) fiorino25;
select * from quota_stagione(2026);
select codice_articolo, lotto_rif, stima, round(costo_confezione,4) conf, round(costo_miele,4) miele, round(costo_confezione+costo_miele,4) tot, prezzo from v_costo_vasetti order by variante_id;
