-- Dati di prova identici alla demo v3.2 (2025-2026) per confrontare i costi
\set ON_ERROR_STOP 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222');
insert into profili (id,username,nome,cognome,ruolo) values
 ('11111111-1111-1111-1111-111111111111','filippo.menossi','Filippo','Menossi','admin'),
 ('22222222-2222-2222-2222-222222222222','anna.menossi','Anna','Menossi','staff');

set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);

-- articoli extra
insert into articoli (nome, categoria_id, magazzino, unita, scorta_minima)
select 'Candito proteico', id, 'apistiche', 'kg', 5 from categorie_articolo where codice='ali';
insert into articoli_confezioni (articolo_id, nome, quantita)
select id, x.n, x.q from articoli, (values ('panetto',1),('cartone',15)) x(n,q) where nome='Candito proteico';
insert into articoli (nome, categoria_id, magazzino, unita, scorta_minima)
select 'Strisce antivarroa', id, 'apistiche', 'pz', 10 from categorie_articolo where codice='trat';
insert into articoli (nome, categoria_id, magazzino, unita) select 'Arnia Dadant', id, null, 'pz' from categorie_articolo where codice='attr';
insert into articoli (nome, categoria_id, magazzino, unita) select 'Guanti da apicoltore', id, null, 'pz' from categorie_articolo where codice='altro';
insert into articoli (nome, categoria_id, magazzino, unita) select 'Assicurazione Fiorino', id, null, 'pz' from categorie_articolo where codice='mezzi';

insert into postazioni (nome, localita, km_abituali, arnie) values
 ('Robinieto di Porpetto','Porpetto',60,8),('Campagna di Castions','Castions di Strada',56,6),
 ('Colline di Buttrio','Buttrio',45,6),('Prealpi Giulie','Lusevera',70,6),('Pianura di Palmanova','Palmanova',35,8);

create temp table A as select id, nome from articoli;
create or replace function pg_temp.a(n text) returns int language sql as $$ select id from articoli where nome=n $$;
create or replace function pg_temp.r(n text, q numeric, t numeric) returns jsonb language sql as
 $$ select jsonb_build_object('articolo_id', pg_temp.a(n), 'quantita', q, 'totale', t) $$;
create or replace function pg_temp.g(q numeric, t numeric, odo int) returns jsonb language sql as
 $$ select jsonb_build_object('articolo_id', pg_temp.a('Gasolio'), 'quantita', q, 'totale', t, 'mezzo_id', 1, 'contachilometri', odo) $$;

select registra_acquisto('2025-02-14', null, 'Vetreria Friulana', jsonb_build_array(
  pg_temp.r('Vasetto 125g',200,50), pg_temp.r('Vasetto 500g',500,175), pg_temp.r('Vasetto 1kg',200,100),
  pg_temp.r('Tappo 125g',200,12), pg_temp.r('Tappo 500g',500,40), pg_temp.r('Tappo 1kg',200,20),
  pg_temp.r('Etichetta 125g',200,20), pg_temp.r('Etichetta 500g',500,60), pg_temp.r('Etichetta 1kg',200,30),
  pg_temp.r('Sigillo Acacia',300,15), pg_temp.r('Sigillo Millefiori',300,15)));
select registra_acquisto('2025-03-06', null, 'Consorzio Apicoltori FVG', jsonb_build_array(pg_temp.r('Candito proteico',30,66)));
select registra_acquisto('2025-03-20', null, 'Distributore Bagnaria', jsonb_build_array(pg_temp.g(60,105,212400)));
select registra_acquisto('2025-04-02', null, 'Agenzia assicurativa Cervignano', jsonb_build_array(pg_temp.r('Assicurazione Fiorino',1,370)));
select registra_acquisto('2025-08-18', null, 'Consorzio Apicoltori FVG', jsonb_build_array(pg_temp.r('Strisce antivarroa',40,58), pg_temp.r('Candito proteico',15,34)));
select registra_acquisto('2025-08-22', null, 'distributore bagnaria', jsonb_build_array(pg_temp.g(50,88,213900)));
select registra_acquisto('2025-11-10', null, 'Distributore Bagnaria', jsonb_build_array(pg_temp.g(30,52,214500)));
select registra_acquisto('2026-02-12', null, 'Vetreria Friulana', jsonb_build_array(
  pg_temp.r('Vasetto 500g',400,152), pg_temp.r('Vasetto 1kg',150,81), pg_temp.r('Tappo 500g',400,36), pg_temp.r('Tappo 1kg',150,16.5),
  pg_temp.r('Etichetta 500g',400,52), pg_temp.r('Etichetta 1kg',150,24), pg_temp.r('Sigillo Acacia',300,17), pg_temp.r('Sigillo Millefiori',400,22)));
-- candito in confezioni: 2 cartoni da 15 kg = 30 kg
select registra_acquisto('2026-02-20', null, 'Consorzio Apicoltori FVG', jsonb_build_array(jsonb_build_object(
  'articolo_id', pg_temp.a('Candito proteico'), 'quantita', 2, 'totale', 72,
  'confezione_id', (select id from articoli_confezioni where nome='cartone'))));
select registra_acquisto('2026-04-02', null, 'Agenzia assicurativa Cervignano', jsonb_build_array(pg_temp.r('Assicurazione Fiorino',1,385)));
select registra_acquisto('2026-04-08', null, 'Distributore Bagnaria', jsonb_build_array(pg_temp.g(70,126,215200)));
select registra_acquisto('2026-04-15', null, 'Apicoltura Nord Est', jsonb_build_array(
  pg_temp.r('Arnia Dadant',4,520) || '{"cespite":{"nome":"Arnia Dadant","categoria_id":1,"vita_utile":10,"contributo":200,"quantita":4}}'));
select registra_acquisto('2026-07-10', null, 'Consorzio Apicoltori FVG', jsonb_build_array(pg_temp.r('Strisce antivarroa',40,62)));
select registra_acquisto('2026-07-24', null, 'Distributore Bagnaria', jsonb_build_array(pg_temp.g(40,74,216600), pg_temp.r('Guanti da apicoltore',1,12)));
select registra_acquisto('2026-09-05', null, 'Consorzio Apicoltori FVG', jsonb_build_array(pg_temp.r('Candito proteico',15,36)));

insert into cespiti (nome, categoria_id, quantita, anno_acquisto, prezzo, contributo, vita_utile) values
 ('Arnie Dadant',1,10,2022,1300,0,10),('Smielatore 4 telaini',2,1,2021,850,0,15),
 ('Maturatori 50 kg',3,2,2021,240,0,12),('Attrezzi vari',4,1,2023,180,0,5);

-- attività di stagione
select registra_attivita('nutrizione','2025-03-12',pg_temp.a('Candito proteico'),10,90);
select registra_attivita('nutrizione','2025-04-10',pg_temp.a('Candito proteico'),8,80);
select registra_attivita('trattamento','2025-08-25',pg_temp.a('Strisce antivarroa'),30,120,'2 strisce per arnia');
select registra_attivita('nutrizione','2025-09-20',pg_temp.a('Candito proteico'),12,90);
select registra_attivita('nutrizione','2025-10-15',pg_temp.a('Candito proteico'),10,90);
select registra_attivita('nutrizione','2026-03-10',pg_temp.a('Candito proteico'),12,100, null, array[1,2]);
select registra_attivita('nutrizione','2026-04-12',pg_temp.a('Candito proteico'),10,90);
select registra_attivita('trattamento','2026-08-20',pg_temp.a('Strisce antivarroa'),28,120,'2 strisce per arnia');
select registra_attivita('nutrizione','2026-09-15',pg_temp.a('Candito proteico'),8,70);

-- lotti (tipi: 1 ACA, 2 CAS, 3 MIL; varianti 1-3 ACA, 4-6 CAS, 7-9 MIL; mezzi 1 Fiorino, 2 Auto, 3 Amico)
do $$
declare l bigint;
begin
  l := nuovo_lotto(1, 2025);
  perform registra_evento_lotto(l,'spostamento','2025-04-22 12:00',1,1,60,180,10);
  perform registra_evento_lotto(l,'spostamento','2025-05-30 12:00',2,1,55,170,10);
  perform registra_evento_lotto(l,'smielatura','2025-06-05 12:00',null,null,null,240,null,null,null,array[48,52,38]);
  perform confeziona(l,'[{"variante_id":1,"pezzi":40},{"variante_id":2,"pezzi":150},{"variante_id":3,"pezzi":55}]','2025-06-12 12:00',300);
  perform chiudi_lotto(l, 0, '[{"variante_id":2,"pezzi":2}]', '2025-06-14');

  l := nuovo_lotto(3, 2025);
  perform registra_evento_lotto(l,'spostamento','2025-06-10 12:00',3,1,40,150,10);
  perform registra_evento_lotto(l,'smielatura','2025-07-20 12:00',null,null,null,260,null,null,null,array[55,60,42]);
  perform confeziona(l,'[{"variante_id":7,"pezzi":40},{"variante_id":8,"pezzi":160},{"variante_id":9,"pezzi":68}]','2025-07-26 12:00',320);
  perform chiudi_lotto(l, 1, '[{"variante_id":9,"pezzi":1}]', '2025-07-28');

  l := nuovo_lotto(2, 2025);
  perform registra_evento_lotto(l,'spostamento','2025-06-28 12:00',4,1,70,200,6);
  perform registra_evento_lotto(l,'smielatura','2025-09-10 12:00',null,null,null,200,null,null,null,array[40,38]);
  perform confeziona(l,'[{"variante_id":5,"pezzi":80},{"variante_id":6,"pezzi":36}]','2025-09-16 12:00',200);
  perform chiudi_lotto(l, 0, '[]', '2025-09-18');

  l := nuovo_lotto(1, 2026);
  perform registra_evento_lotto(l,'spostamento','2026-04-20 12:00',1,3,60,180,14,30);
  perform registra_evento_lotto(l,'spostamento','2026-05-28 12:00',2,1,58,160,14);
  perform registra_evento_lotto(l,'smielatura','2026-06-02 12:00',null,null,null,240,null,null,null,array[50,55,45]);
  perform confeziona(l,'[{"variante_id":1,"pezzi":40},{"variante_id":2,"pezzi":160},{"variante_id":3,"pezzi":60}]','2026-06-09 12:00',300,2,20);
  perform chiudi_lotto(l, 1, '[{"variante_id":2,"pezzi":2}]', '2026-06-11');

  l := nuovo_lotto(3, 2026);
  perform registra_evento_lotto(l,'spostamento','2026-06-08 12:00',3,1,45,150,14);
  perform registra_evento_lotto(l,'smielatura','2026-07-18 12:00',null,null,null,260,null,null,null,array[58,62,40]);
  perform confeziona(l,'[{"variante_id":7,"pezzi":40},{"variante_id":8,"pezzi":170},{"variante_id":9,"pezzi":65}]','2026-07-25 12:00',330);
  perform chiudi_lotto(l, 0, '[{"variante_id":9,"pezzi":1}]', '2026-07-27');

  l := nuovo_lotto(2, 2026);
  perform registra_evento_lotto(l,'spostamento','2026-06-26 12:00',4,1,70,210,6);
  perform registra_evento_lotto(l,'smielatura','2026-09-08 12:00',null,null,null,180,null,null,null,array[36,34]);

  l := nuovo_lotto(3, 2026);
  perform registra_evento_lotto(l,'spostamento','2026-08-28 12:00',5,1,35,120,8);
  perform registra_evento_lotto(l,'smielatura','2026-09-12 12:00',null,null,null,200,null,null,null,array[44,47]);
  perform confeziona(l,'[{"variante_id":8,"pezzi":60},{"variante_id":9,"pezzi":20}]','2026-09-20 12:00',180);
end $$;
-- come nella demo: i lotti chiusi si congelano con tutti i dati presenti
select ricalcola_tutti_lotti();
