-- E-Rechnung, Phase 1b: Erzeugung, Archiv, Sperre, Storno.
--
-- Additiv und idempotent. Bestehende Rechnungen, Gutschriften, Beträge
-- und Nummern werden NICHT verändert (einzige neue Daten: die
-- Einstellung 'firmendaten' mit den bisherigen Werten aus dem Code).
--
--  1. Status 'storniert' wieder zulassen (Migration 043 hatte ihn
--     entfernt) + storniert_am.
--  2. Format 'en16931_cii' (E-Rechnung EN 16931 ohne XRechnung-Regeln).
--  3. Firmendaten als Einstellung; Absender-Snapshot je Rechnung bzw.
--     Gutschrift beim Erstellen (Entwurf → erstellt/final).
--  4. Leistungsdatum je Position (= Enddatum der Tour), beim Anlegen
--     und beim Erstellen der Rechnung aus der Tour übernommen.
--  5. erechnung_dokumente — Archiv-Verzeichnis, nur INSERT (Server mit
--     Service-Rolle), kein UPDATE/DELETE, lesen nur Admin.
--  6. Sperre: Rechnung/Gutschrift mit E-Rechnung ist serverseitig
--     schreibgeschützt (außer Status bezahlt/offen/storniert, bezahlt_am,
--     interne Notizen, Versand-Zeitpunkt).
--  7. Storno: rechnung_stornieren() legt eine Stornorechnung (Gutschrift,
--     Art 'storno') über den vollen Betrag an und setzt das Original
--     auf 'storniert' — in einer Transaktion.
--  8. Privater Bucket 'erechnung' (zweite Ablage des XML).

-- ------------------------------------------------------------
-- 1. Status 'storniert'
-- ------------------------------------------------------------
alter table public.rechnungen drop constraint if exists rechnungen_status_check;
alter table public.rechnungen add constraint rechnungen_status_check
  check (status in ('entwurf', 'offen', 'bezahlt', 'storniert'));
alter table public.rechnungen add column if not exists storniert_am timestamptz;

-- ------------------------------------------------------------
-- 2. Formate
-- ------------------------------------------------------------
alter table public.auftraggeber        drop constraint if exists auftraggeber_erechnung_format_check;
alter table public.manuelle_empfaenger drop constraint if exists manuelle_empfaenger_erechnung_format_check;
alter table public.rechnungen          drop constraint if exists rechnungen_erechnung_format_check;
alter table public.auftraggeber add constraint auftraggeber_erechnung_format_check
  check (erechnung_format in ('pdf', 'en16931_cii', 'xrechnung_cii', 'zugferd'));
alter table public.manuelle_empfaenger add constraint manuelle_empfaenger_erechnung_format_check
  check (erechnung_format in ('pdf', 'en16931_cii', 'xrechnung_cii', 'zugferd'));
alter table public.rechnungen add constraint rechnungen_erechnung_format_check
  check (erechnung_format is null or erechnung_format in ('pdf', 'en16931_cii', 'xrechnung_cii', 'zugferd'));

-- ------------------------------------------------------------
-- 3. Firmendaten + Snapshot
-- ------------------------------------------------------------
insert into public.app_settings (key, value) values ('firmendaten', jsonb_build_object(
  'firmenname', 'Maja-Logistik M.Janßen',
  'kurzname', 'Maja-Logistik',
  'inhaber', null, 'rechtsform', null,
  'registergericht', null, 'registernummer', null,
  'strasse', 'Heiligenroder Strasse 38e', 'plz', '28816', 'ort', 'Stuhr-Heiligenrode', 'land_code', 'DE',
  'telefon', '+49 17641461645', 'email', 'info@maja-logistik.de',
  'ust_id', 'DE309356726', 'steuernummer', null,
  'kontakt_name', null, 'kontakt_telefon', '+49 17641461645', 'kontakt_email', 'info@maja-logistik.de',
  'elektronische_adresse', 'info@maja-logistik.de',
  'iban', 'DE04280501000001429760', 'bic', 'SLZODE22XXX', 'bank', null
)) on conflict (key) do nothing;

alter table public.rechnungen   add column if not exists absender_snapshot jsonb;
alter table public.gutschriften add column if not exists absender_snapshot jsonb;
comment on column public.rechnungen.absender_snapshot is
  'Firmendaten (app_settings firmendaten) beim Übergang Entwurf → erstellt. PDF und E-Rechnung nutzen ihn; NULL = Rechnung von vor Migration 116.';

-- Gutschriften: Art, Bezug, E-Rechnungs-Angaben
alter table public.gutschriften
  add column if not exists art                  text not null default 'gutschrift',
  add column if not exists bezug_rechnungsnummer text,
  add column if not exists bezug_rechnungsdatum  date,
  add column if not exists erechnung_format     text,
  add column if not exists erechnung_email      text,
  add column if not exists kaeufer_referenz     text;
alter table public.gutschriften drop constraint if exists gutschriften_art_check;
alter table public.gutschriften add constraint gutschriften_art_check
  check (art in ('gutschrift', 'storno', 'teilgutschrift'));
alter table public.gutschriften drop constraint if exists gutschriften_art_bezug_check;
alter table public.gutschriften add constraint gutschriften_art_bezug_check
  check (art = 'gutschrift' or rechnung_id is not null);
alter table public.gutschriften drop constraint if exists gutschriften_erechnung_format_check;
alter table public.gutschriften add constraint gutschriften_erechnung_format_check
  check (erechnung_format is null or erechnung_format in ('pdf', 'en16931_cii', 'xrechnung_cii', 'zugferd'));

-- ------------------------------------------------------------
-- 4. Leistungsdatum je Position
-- ------------------------------------------------------------
alter table public.rechnungspositionen   add column if not exists leistungsdatum date;
alter table public.gutschriftspositionen add column if not exists leistungsdatum date;
comment on column public.rechnungspositionen.leistungsdatum is
  'Leistungsdatum (Tag des Tourabschlusses = Enddatum der Tour). Aus der Tour übernommen beim Anlegen der Position und beim Erstellen der Rechnung; NULL bei Positionen ohne Tour.';

create or replace function public.position_leistungsdatum()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tour_id is not null
     and (tg_op = 'INSERT' or new.tour_id is distinct from old.tour_id or new.leistungsdatum is null) then
    select coalesce(t.enddatum, t.startdatum) into new.leistungsdatum from touren t where t.id = new.tour_id;
  end if;
  return new;
end;
$$;
drop trigger if exists rechnungspositionen_leistungsdatum on public.rechnungspositionen;
create trigger rechnungspositionen_leistungsdatum
  before insert or update of tour_id on public.rechnungspositionen
  for each row execute function public.position_leistungsdatum();
drop trigger if exists gutschriftspositionen_leistungsdatum on public.gutschriftspositionen;
create trigger gutschriftspositionen_leistungsdatum
  before insert or update of tour_id on public.gutschriftspositionen
  for each row execute function public.position_leistungsdatum();

-- ------------------------------------------------------------
-- 3b/4b. Beim Erstellen: Snapshot + E-Rechnungs-Angaben + Leistungsdatum
-- ------------------------------------------------------------
create or replace function public.rechnung_beim_erstellen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ag record;
begin
  if new.status = 'entwurf' then return new; end if;
  if tg_op = 'UPDATE' and old.status is distinct from 'entwurf' then return new; end if;
  new.absender_snapshot := (select value from app_settings where key = 'firmendaten');
  if new.empfaenger_typ is distinct from 'manuell' and new.auftraggeber_id is not null then
    select a.erechnung_format, a.erechnung_email, a.kaeufer_referenz into v_ag
      from auftraggeber a where a.id = new.auftraggeber_id;
    new.erechnung_format := coalesce(v_ag.erechnung_format, 'pdf');
    new.erechnung_email  := coalesce(new.erechnung_email, v_ag.erechnung_email);
    new.kaeufer_referenz := coalesce(new.kaeufer_referenz, v_ag.kaeufer_referenz);
  else
    new.erechnung_format := coalesce(new.erechnung_format, 'pdf');
  end if;
  return new;
end;
$$;
drop trigger if exists rechnung_erstellen_snapshot on public.rechnungen;
create trigger rechnung_erstellen_snapshot
  before insert or update of status on public.rechnungen
  for each row execute function public.rechnung_beim_erstellen();

-- Positionen beim Erstellen auf das aktuelle Tour-Enddatum bringen
-- (Touren können sich im Entwurf noch geändert haben).
create or replace function public.rechnung_leistungsdaten_auffrischen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'entwurf' and new.status <> 'entwurf' then
    update rechnungspositionen p
       set leistungsdatum = coalesce(t.enddatum, t.startdatum)
      from touren t
     where p.rechnung_id = new.id and t.id = p.tour_id
       and p.leistungsdatum is distinct from coalesce(t.enddatum, t.startdatum);
  end if;
  return null;
end;
$$;
drop trigger if exists rechnung_erstellen_leistungsdaten on public.rechnungen;
create trigger rechnung_erstellen_leistungsdaten
  after update of status on public.rechnungen
  for each row execute function public.rechnung_leistungsdaten_auffrischen();

create or replace function public.gutschrift_beim_finalisieren()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'final' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'final' then return new; end if;
  new.absender_snapshot := (select value from app_settings where key = 'firmendaten');
  return new;
end;
$$;
drop trigger if exists gutschrift_final_snapshot on public.gutschriften;
create trigger gutschrift_final_snapshot
  before insert or update of status on public.gutschriften
  for each row execute function public.gutschrift_beim_finalisieren();

-- ------------------------------------------------------------
-- 5. Archiv-Verzeichnis
-- ------------------------------------------------------------
create table if not exists public.erechnung_dokumente (
  id              uuid primary key default gen_random_uuid(),
  rechnung_id     uuid references public.rechnungen(id) on delete restrict,
  gutschrift_id   uuid references public.gutschriften(id) on delete restrict,
  version         integer not null default 1 check (version >= 1),
  format          text not null check (format in ('en16931_cii', 'xrechnung_cii', 'zugferd')),
  typ_code        text not null,
  belegnummer     text not null,
  xml_pfad        text not null,
  pdf_pfad        text not null,
  bucket_pfad     text not null,
  sha256_xml      text not null check (sha256_xml ~ '^[0-9a-f]{64}$'),
  sha256_pdf      text not null check (sha256_pdf ~ '^[0-9a-f]{64}$'),
  xml_bytes       integer not null,
  pdf_bytes       integer not null,
  erzeugt_am      timestamptz not null default now(),
  erzeugt_von     uuid,
  erzeugt_von_name text,
  constraint erechnung_dokumente_ein_beleg check (num_nonnulls(rechnung_id, gutschrift_id) = 1)
);
create unique index if not exists erechnung_dokumente_rechnung_version on public.erechnung_dokumente (rechnung_id, version) where rechnung_id is not null;
create unique index if not exists erechnung_dokumente_gutschrift_version on public.erechnung_dokumente (gutschrift_id, version) where gutschrift_id is not null;
comment on table public.erechnung_dokumente is
  'Archiv der erzeugten E-Rechnungen (XML maßgeblich + PDF-Lesekopie). Nur INSERT durch den Server (Service-Rolle); UPDATE/DELETE gesperrt.';

alter table public.erechnung_dokumente enable row level security;
drop policy if exists erechnung_dokumente_lesen on public.erechnung_dokumente;
create policy erechnung_dokumente_lesen on public.erechnung_dokumente
  for select using (public.is_admin());
revoke all on public.erechnung_dokumente from anon, authenticated;
grant select on public.erechnung_dokumente to authenticated;
grant select, insert on public.erechnung_dokumente to service_role;

create or replace function public.erechnung_dokumente_unveraenderlich()
returns trigger language plpgsql as $$
begin
  raise exception 'ERECHNUNG_ARCHIV: Archivierte E-Rechnungen dürfen nicht geändert oder gelöscht werden.'
    using errcode = '42501';
end;
$$;
drop trigger if exists erechnung_dokumente_kein_update on public.erechnung_dokumente;
create trigger erechnung_dokumente_kein_update
  before update or delete on public.erechnung_dokumente
  for each row execute function public.erechnung_dokumente_unveraenderlich();
drop trigger if exists erechnung_dokumente_kein_truncate on public.erechnung_dokumente;
create trigger erechnung_dokumente_kein_truncate
  before truncate on public.erechnung_dokumente
  for each statement execute function public.erechnung_dokumente_unveraenderlich();

create or replace function public.rechnung_hat_erechnung(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from erechnung_dokumente where rechnung_id = p_id);
$$;
create or replace function public.gutschrift_hat_erechnung(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from erechnung_dokumente where gutschrift_id = p_id);
$$;
grant execute on function public.rechnung_hat_erechnung(uuid) to authenticated;
grant execute on function public.gutschrift_hat_erechnung(uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. Sperre
-- ------------------------------------------------------------
create or replace function public.rechnung_sperre()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Diese Felder bleiben nach dem Erzeugen der E-Rechnung änderbar.
  frei constant text[] := array['status', 'bezahlt_am', 'notizen', 'email_versendet_am',
                                'updated_at', 'belege_pdf_url', 'storniert_am', 'pdf_url'];
begin
  -- Für ALLE Rechnungen: eine Rechnung mit Storno/Teilgutschrift-Bezug
  -- darf nicht gelöscht werden, eine stornierte bleibt storniert.
  if tg_op = 'DELETE' and exists (select 1 from gutschriften g where g.rechnung_id = old.id and g.art in ('storno', 'teilgutschrift')) then
    raise exception 'STORNO_BEZUG: Zu dieser Rechnung gibt es eine Stornorechnung/Teilgutschrift — sie kann nicht gelöscht werden.'
      using errcode = '42501';
  end if;
  if old.status = 'storniert' and not rechnung_hat_erechnung(old.id) then
    if tg_op = 'DELETE' then
      raise exception 'STORNIERT: Stornierte Rechnungen können nicht gelöscht werden.' using errcode = '42501';
    end if;
    if new.status is distinct from 'storniert'
       or (to_jsonb(new) - frei) is distinct from (to_jsonb(old) - frei) then
      raise exception 'STORNIERT: Die Rechnung ist storniert und kann nicht mehr geändert werden.' using errcode = '42501';
    end if;
    return new;
  end if;
  if not rechnung_hat_erechnung(old.id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'ERECHNUNG_GESPERRT: E-Rechnung erstellt — die Rechnung kann nicht gelöscht werden. Änderung nur über Storno/Teilgutschrift.'
      using errcode = '42501';
  end if;
  if (to_jsonb(new) - frei) is distinct from (to_jsonb(old) - frei)
     or (old.pdf_url is not null and new.pdf_url is distinct from old.pdf_url)
     or new.status = 'entwurf'
     or (old.status = 'storniert' and new.status is distinct from 'storniert') then
    raise exception 'ERECHNUNG_GESPERRT: E-Rechnung erstellt — Änderung nur über Storno/Teilgutschrift.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists rechnung_sperre on public.rechnungen;
create trigger rechnung_sperre
  before update or delete on public.rechnungen
  for each row execute function public.rechnung_sperre();

create or replace function public.rechnungsposition_sperre()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op <> 'INSERT' and rechnung_hat_erechnung(old.rechnung_id))
     or (tg_op <> 'DELETE' and rechnung_hat_erechnung(new.rechnung_id)) then
    raise exception 'ERECHNUNG_GESPERRT: E-Rechnung erstellt — Positionen sind nicht mehr änderbar. Änderung nur über Storno/Teilgutschrift.'
      using errcode = '42501';
  end if;
  if exists (select 1 from rechnungen r
              where r.status = 'storniert'
                and r.id in (case when tg_op <> 'INSERT' then old.rechnung_id end,
                             case when tg_op <> 'DELETE' then new.rechnung_id end)) then
    raise exception 'STORNIERT: Die Rechnung ist storniert — Positionen sind nicht mehr änderbar.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists rechnungsposition_sperre on public.rechnungspositionen;
create trigger rechnungsposition_sperre
  before insert or update or delete on public.rechnungspositionen
  for each row execute function public.rechnungsposition_sperre();

create or replace function public.gutschrift_sperre()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  frei text[] := array['email_versendet_am', 'interne_notizen', 'updated_at', 'pdf_url', 'mit_unterschrift', 'mit_stempel'];
begin
  -- Eine Stornorechnung ist immer endgültig (auch als PDF-Beleg): sonst
  -- bliebe das Original „storniert" ohne gültigen Storno-Beleg.
  if old.art = 'storno' and old.status = 'final' and not gutschrift_hat_erechnung(old.id) then
    if tg_op = 'DELETE' then
      raise exception 'STORNO_ENDGUELTIG: Eine Stornorechnung kann nicht gelöscht werden.' using errcode = '42501';
    end if;
    if (to_jsonb(new) - frei) is distinct from (to_jsonb(old) - frei) then
      raise exception 'STORNO_ENDGUELTIG: Eine Stornorechnung kann nicht mehr geändert werden.' using errcode = '42501';
    end if;
    return new;
  end if;
  if not gutschrift_hat_erechnung(old.id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  -- Mit E-Rechnung: Unterschrift/Stempel ändern das Archiv nicht, bleiben aber gesperrt.
  frei := array['email_versendet_am', 'interne_notizen', 'updated_at', 'pdf_url'];
  if tg_op = 'DELETE'
     or (to_jsonb(new) - frei) is distinct from (to_jsonb(old) - frei)
     or (old.pdf_url is not null and new.pdf_url is distinct from old.pdf_url) then
    raise exception 'ERECHNUNG_GESPERRT: E-Rechnung erstellt — der Beleg ist nicht mehr änderbar oder löschbar.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists gutschrift_sperre on public.gutschriften;
create trigger gutschrift_sperre
  before update or delete on public.gutschriften
  for each row execute function public.gutschrift_sperre();

create or replace function public.gutschriftsposition_sperre()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op <> 'INSERT' and gutschrift_hat_erechnung(old.gutschrift_id))
     or (tg_op <> 'DELETE' and gutschrift_hat_erechnung(new.gutschrift_id)) then
    raise exception 'ERECHNUNG_GESPERRT: E-Rechnung erstellt — Positionen sind nicht mehr änderbar.'
      using errcode = '42501';
  end if;
  if exists (select 1 from gutschriften g
              where g.art = 'storno' and g.status = 'final'
                and g.id in (case when tg_op <> 'INSERT' then old.gutschrift_id end,
                             case when tg_op <> 'DELETE' then new.gutschrift_id end)) then
    raise exception 'STORNO_ENDGUELTIG: Positionen einer Stornorechnung sind nicht änderbar.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists gutschriftsposition_sperre on public.gutschriftspositionen;
create trigger gutschriftsposition_sperre
  before insert or update or delete on public.gutschriftspositionen
  for each row execute function public.gutschriftsposition_sperre();

-- ------------------------------------------------------------
-- 7. Storno
-- ------------------------------------------------------------
create or replace function public.rechnung_stornieren(p_rechnung_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r  rechnungen%rowtype;
  v_id uuid;
begin
  if not public.is_admin() or public.is_test() then
    raise exception 'NUR_ADMIN: Stornieren darf nur ein Admin.' using errcode = '42501';
  end if;
  select * into r from rechnungen where id = p_rechnung_id for update;
  if not found then raise exception 'Rechnung nicht gefunden'; end if;
  if r.status not in ('offen', 'bezahlt') then
    raise exception 'STORNO_NICHT_MOEGLICH: Nur erstellte Rechnungen (offen/bezahlt) können storniert werden (Status: %).', r.status;
  end if;

  insert into gutschriften (
    art, rechnung_id, bezug_rechnungsnummer, bezug_rechnungsdatum,
    auftraggeber_id, rechnungsempfaenger_id, datum, leistungszeitraum_von, leistungszeitraum_bis,
    anrede, einleitungstext, adress_snapshot, kundennummer, sachbearbeiter,
    ust_satz, netto_summe, ust_summe, brutto_summe, status,
    empfaenger_typ, empfaenger_email, empfaenger_ust_id, mit_unterschrift, mit_stempel,
    erechnung_format, erechnung_email, kaeufer_referenz
  ) values (
    'storno', r.id, r.rechnungsnummer, r.datum,
    r.auftraggeber_id, r.rechnungsempfaenger_id, current_date, r.leistungszeitraum_von, r.leistungszeitraum_bis,
    r.anrede,
    'Hiermit stornieren wir die Rechnung ' || r.rechnungsnummer || ' vom ' || to_char(r.datum, 'DD.MM.YYYY') || ' in voller Höhe.',
    jsonb_build_object('firma', r.rechnungsadresse_firma, 'ansprechpartner', r.ansprechpartner,
      'strasse', r.rechnungsadresse_strasse, 'plz_ort', r.rechnungsadresse_plz_ort, 'land', r.rechnungsadresse_land,
      'plz', r.rechnungsadresse_plz, 'ort', r.rechnungsadresse_ort, 'land_code', r.rechnungsadresse_land_code),
    r.kundennummer, r.sachbearbeiter,
    r.ust_satz, r.netto_summe, r.ust_betrag, r.brutto_summe, 'entwurf',
    r.empfaenger_typ, r.empfaenger_email, r.empfaenger_ust_id, r.mit_unterschrift, r.mit_stempel,
    coalesce(r.erechnung_format, 'pdf'), r.erechnung_email, r.kaeufer_referenz
  ) returning id into v_id;

  insert into gutschriftspositionen (gutschrift_id, position_nr, bezeichnung, unterzeilen, menge, einzelpreis, gesamtpreis, ust_satz, tour_id, ist_manuell, leistungsdatum)
  select v_id, p.position_nr, p.bezeichnung, to_jsonb(coalesce(p.unterzeilen, '{}'::text[])), p.menge, p.einzelpreis, p.gesamtpreis,
         p.ust_satz, p.tour_id, p.ist_manuell, p.leistungsdatum
    from rechnungspositionen p where p.rechnung_id = r.id order by p.position_nr;
  -- Leistungsdatum der Stornopositionen = das der Originalrechnung
  -- (der Insert-Trigger hätte es aus der heutigen Tour gelesen).
  update gutschriftspositionen g set leistungsdatum = p.leistungsdatum
    from rechnungspositionen p
   where g.gutschrift_id = v_id and p.rechnung_id = r.id and p.position_nr = g.position_nr;
  -- Erst jetzt endgültig: setzt den Firmendaten-Snapshot, danach gesperrt.
  update gutschriften set status = 'final' where id = v_id;

  update rechnungen set status = 'storniert', storniert_am = now() where id = r.id;
  return v_id;
end;
$$;
revoke all on function public.rechnung_stornieren(uuid) from public;
grant execute on function public.rechnung_stornieren(uuid) to authenticated;

-- ------------------------------------------------------------
-- 8. Privater Bucket (zweite Ablage des XML; schreibt nur der Server)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('erechnung', 'erechnung', false)
on conflict (id) do nothing;
drop policy if exists erechnung_storage_lesen on storage.objects;
create policy erechnung_storage_lesen on storage.objects
  for select using (bucket_id = 'erechnung' and public.is_admin());

notify pgrst, 'reload schema';
