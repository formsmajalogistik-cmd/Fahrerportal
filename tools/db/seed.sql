insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@maja.de'),
 ('00000000-0000-0000-0000-0000000000f1','f1@maja.de'),
 ('00000000-0000-0000-0000-0000000000f2','f2@maja.de'),
 ('00000000-0000-0000-0000-0000000000b1','ag@arval.de'),
 ('00000000-0000-0000-0000-0000000000e1','test@maja.de') on conflict do nothing;
insert into app_users (id, email, role) values
 ('00000000-0000-0000-0000-0000000000a1','admin@maja.de','admin'),
 ('00000000-0000-0000-0000-0000000000f1','f1@maja.de','fahrer'),
 ('00000000-0000-0000-0000-0000000000f2','f2@maja.de','fahrer'),
 ('00000000-0000-0000-0000-0000000000b1','ag@arval.de','auftraggeber'),
 ('00000000-0000-0000-0000-0000000000e1','test@maja.de','test')
on conflict (id) do update set role = excluded.role;
insert into auftraggeber (id, name) values ('00000000-0000-0000-0000-0000000000a9','Arval');
update app_users set auftraggeber_id = '00000000-0000-0000-0000-0000000000a9' where id = '00000000-0000-0000-0000-0000000000b1';
insert into fahrer (id, user_id, vorname, nachname) values ('0000000f-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1','Kemal','Yilmaz');
insert into touren (id, start_stadt, ziel_stadt, auftraggeber_id, fahrer_id, startdatum, enddatum)
values ('11111111-1111-1111-1111-111111111111','Bremen','Hamburg','00000000-0000-0000-0000-0000000000a9','0000000f-0000-0000-0000-000000000001','2026-10-30','2026-10-30'),
       ('22222222-2222-2222-2222-222222222222','Bremen','Kiel','00000000-0000-0000-0000-0000000000a9','0000000f-0000-0000-0000-000000000001','2026-10-30','2026-10-30');
