-- E-Rechnung: PLZ/Ort/Land-Code übernehmen — PROBELAUF (nichts wird gespeichert).
--
-- Führt GENAU dieselbe Änderung aus wie erechnung_adressen_schreiben.sql und
-- nimmt sie mit ROLLBACK wieder zurück.
--
-- Übernimmt die Vorschläge aus erechnung_adressen_probelauf.sql (gleiche
-- Regeln, wortgleich übernommen) in die Stammdaten:
--   * Rechnungsadressen:     plz, ort, land_code   (aus plz_ort / land)
--   * Auftraggeber:          land_code             (plz/ort sind dort schon getrennt)
--   * Manuelle Empfänger:    land_code             (aus land)
-- NICHT angefasst: Snapshots erstellter Rechnungen/Gutschriften, plz_ort,
-- land (Freitext), alle anderen Spalten.
--
-- Sicherungen:
--   * geschrieben werden NUR Zeilen mit Status „eindeutig"
--   * bereits gefüllte Felder plz/ort/land_code werden NIE überschrieben;
--     weicht ein gefülltes Feld vom Vorschlag ab, wird die ganze Zeile
--     nicht angefasst und als „manuell prüfen" gelistet
--   * mehrfach ausführbar: beim zweiten Lauf ist alles schon gefüllt →
--     nichts wird geschrieben
--
-- Ergebnis-Tabelle: „geschrieben" (mit den geschriebenen Werten) und alle
-- noch offenen Zeilen „manuell prüfen" (mit Vorschlag, soweit vorhanden) —
-- diese bitte selbst in der App eintragen. Bereits erledigte Zeilen
-- erscheinen nicht mehr.
--
-- Ablauf dieser Datei:
--   1. begin
--   2. die Änderung (identisch zur Schreib-Variante) — liefert die Tabelle
--      „geschrieben / manuell prüfen"
--   3. rollback — alles wieder zurück
--   4. dieselbe Auswahl noch einmal NUR LESEND („würde geschrieben" /
--      „manuell prüfen"). Grund: Der Supabase-SQL-Editor zeigt bei mehreren
--      Anweisungen nur das Ergebnis der letzten an; ohne Schritt 4 sähe man
--      dort nur das Rollback. Die Zeilen sind dieselben wie in Schritt 2.
--
-- Erwartung: Schritt 4 zeigt, was der echte Lauf schreiben würde.

begin;

with land_map(eingabe, code) as (
  values
    ('deutschland','DE'),('germany','DE'),('de','DE'),('d','DE'),('brd','DE'),('bundesrepublik deutschland','DE'),
    ('österreich','AT'),('oesterreich','AT'),('austria','AT'),('at','AT'),('a','AT'),
    ('schweiz','CH'),('switzerland','CH'),('ch','CH'),
    ('niederlande','NL'),('holland','NL'),('netherlands','NL'),('nl','NL'),
    ('belgien','BE'),('belgium','BE'),('be','BE'),
    ('luxemburg','LU'),('luxembourg','LU'),('lu','LU'),
    ('frankreich','FR'),('france','FR'),('fr','FR'),
    ('dänemark','DK'),('daenemark','DK'),('denmark','DK'),('dk','DK'),
    ('polen','PL'),('poland','PL'),('pl','PL'),
    ('tschechien','CZ'),('tschechische republik','CZ'),('czech republic','CZ'),('cz','CZ'),
    ('italien','IT'),('italy','IT'),('it','IT'),
    ('spanien','ES'),('spain','ES'),('es','ES'),
    ('schweden','SE'),('sweden','SE'),('se','SE'),
    ('norwegen','NO'),('norway','NO'),('no','NO'),
    ('vereinigtes königreich','GB'),('großbritannien','GB'),('united kingdom','GB'),('uk','GB'),('gb','GB')
),
quellen as (
  -- ist_*: heutiger Inhalt der Zielfelder (leer = NULL)
  select 'Rechnungsadresse'::text as quelle, ra.id,
         a.name || ' — ' || coalesce(ra.firma, '') as empfaenger,
         btrim(coalesce(ra.plz_ort, '')) as plz_ort_bisher,
         null::text as plz_bisher, null::text as ort_bisher,
         btrim(coalesce(ra.land, '')) as land_bisher,
         nullif(btrim(coalesce(ra.plz, '')), '') as ist_plz,
         nullif(btrim(coalesce(ra.ort, '')), '') as ist_ort,
         nullif(btrim(coalesce(ra.land_code, '')), '') as ist_land
    from public.rechnungsadressen ra
    join public.auftraggeber a on a.id = ra.auftraggeber_id
  union all
  select 'Auftraggeber', a.id, a.name,
         btrim(concat_ws(' ', nullif(btrim(a.plz), ''), nullif(btrim(a.ort), ''))),
         btrim(coalesce(a.plz, '')), btrim(coalesce(a.ort, '')), '',
         null, null, nullif(btrim(coalesce(a.land_code, '')), '')
    from public.auftraggeber a
  union all
  select 'Manueller Empfänger', m.id,
         coalesce(nullif(btrim(m.firma), ''), btrim(concat_ws(' ', m.vorname, m.nachname))),
         btrim(concat_ws(' ', nullif(btrim(m.plz), ''), nullif(btrim(m.ort), ''))),
         btrim(coalesce(m.plz, '')), btrim(coalesce(m.ort, '')),
         btrim(coalesce(m.land, '')),
         null, null, nullif(btrim(coalesce(m.land_code, '')), '')
    from public.manuelle_empfaenger m
),
geparst as (
  -- Regeln exakt wie erechnung_adressen_probelauf.sql
  select q.*,
         case
           when q.land_bisher = '' then 'DE'
           else (select lm.code from land_map lm where lm.eingabe = lower(q.land_bisher))
         end as land_vorschlag,
         case
           when q.plz_bisher is not null then q.plz_bisher
           when q.plz_ort_bisher ~ '^[0-9]{5}\s+\S' then substring(q.plz_ort_bisher from '^([0-9]{5})')
           when q.plz_ort_bisher ~* '^D\s*-?\s*[0-9]{5}\s+\S' then substring(q.plz_ort_bisher from '([0-9]{5})')
         end as plz_vorschlag,
         case
           when q.ort_bisher is not null then q.ort_bisher
           when q.plz_ort_bisher ~ '^[0-9]{5}\s+\S' then btrim(regexp_replace(q.plz_ort_bisher, '^[0-9]{5}\s+', ''))
           when q.plz_ort_bisher ~* '^D\s*-?\s*[0-9]{5}\s+\S' then btrim(regexp_replace(q.plz_ort_bisher, '^[Dd]\s*-?\s*[0-9]{5}\s+', ''))
         end as ort_vorschlag
    from quellen q
),
bewertet as (
  select g.*,
    case
      when plz_ort_bisher = ''                                              then 'manuell prüfen'
      when land_vorschlag is null                                           then 'manuell prüfen'
      when plz_vorschlag is null or coalesce(ort_vorschlag, '') = ''        then 'manuell prüfen'
      when land_vorschlag = 'DE' and plz_vorschlag !~ '^[0-9]{5}$'          then 'manuell prüfen'
      when land_vorschlag <> 'DE'                                           then 'manuell prüfen'
      when ort_vorschlag ~ '[0-9]'                                          then 'manuell prüfen'
      else 'eindeutig'
    end as status,
    concat_ws('; ',
      case when plz_ort_bisher = '' then 'keine PLZ/Ort hinterlegt' end,
      case when land_bisher = '' then 'Land leer → Standard DE' end,
      case when land_vorschlag is null then 'Land „' || land_bisher || '" nicht zugeordnet' end,
      case when land_vorschlag is not null and land_vorschlag <> 'DE' then 'Ausland — PLZ-Format bitte prüfen' end,
      case when plz_ort_bisher ~* '^D\s*-?\s*[0-9]{5}' then 'Präfix „D-" entfernt' end,
      case when plz_vorschlag is null and plz_ort_bisher <> '' then 'Format nicht erkannt' end,
      case when land_vorschlag = 'DE' and plz_vorschlag is not null and plz_vorschlag !~ '^[0-9]{5}$' then 'keine 5-stellige deutsche PLZ' end,
      case when ort_vorschlag ~ '[0-9]' then 'Ziffern im Ort' end
    ) as hinweis
  from geparst g
),
plan as (
  select b.*,
    -- noch etwas zu tun? (Auftraggeber/Manuelle Empfänger: nur der Land-Code;
    -- PLZ/Ort sind dort schon getrennte Felder)
    case when b.quelle = 'Rechnungsadresse' then (b.ist_plz is null or b.ist_ort is null or b.ist_land is null)
         else b.ist_land is null end as offen,
    -- ein bereits gefülltes Feld weicht vom Vorschlag ab → nichts schreiben
    (b.ist_plz is not null and b.ist_plz is distinct from b.plz_vorschlag)
      or (b.ist_ort is not null and b.ist_ort is distinct from b.ort_vorschlag)
      or (b.ist_land is not null and b.ist_land is distinct from b.land_vorschlag) as konflikt
  from bewertet b
),
schreiben as (
  select * from plan where status = 'eindeutig' and offen and not konflikt
),
upd_ra as (
  update public.rechnungsadressen ra
     set plz       = coalesce(nullif(btrim(coalesce(ra.plz, '')), ''), s.plz_vorschlag),
         ort       = coalesce(nullif(btrim(coalesce(ra.ort, '')), ''), s.ort_vorschlag),
         land_code = coalesce(nullif(btrim(coalesce(ra.land_code, '')), ''), s.land_vorschlag)
    from schreiben s
   where s.quelle = 'Rechnungsadresse' and ra.id = s.id
  returning ra.id
),
upd_ag as (
  update public.auftraggeber a
     set land_code = s.land_vorschlag
    from schreiben s
   where s.quelle = 'Auftraggeber' and a.id = s.id and nullif(btrim(coalesce(a.land_code, '')), '') is null
  returning a.id
),
upd_me as (
  update public.manuelle_empfaenger m
     set land_code = s.land_vorschlag
    from schreiben s
   where s.quelle = 'Manueller Empfänger' and m.id = s.id and nullif(btrim(coalesce(m.land_code, '')), '') is null
  returning m.id
),
geschrieben as (
  select id from upd_ra union all select id from upd_ag union all select id from upd_me
)
select
  case
    when p.id in (select id from geschrieben) then 'geschrieben'
    when p.status = 'eindeutig' and p.offen and not p.konflikt then 'nicht geschrieben (?)'
    else 'manuell prüfen' end                                                   as "Ergebnis",
  p.quelle                                                as "Quelle",
  p.empfaenger                                            as "Empfänger",
  p.plz_ort_bisher                                        as "bisher PLZ/Ort",
  nullif(p.land_bisher, '')                               as "bisher Land",
  case when p.quelle = 'Rechnungsadresse' then coalesce(p.ist_plz, p.plz_vorschlag) end as "PLZ",
  case when p.quelle = 'Rechnungsadresse' then coalesce(p.ist_ort, p.ort_vorschlag) end as "Ort",
  coalesce(p.ist_land, p.land_vorschlag)                  as "Land-Code",
  concat_ws('; ', nullif(p.hinweis, ''),
    case when p.konflikt then 'bereits gefülltes Feld weicht vom Vorschlag ab — nichts geschrieben' end) as "Hinweis",
  p.id                                                    as "Datensatz-ID"
from plan p
where (p.status = 'eindeutig' and p.offen and not p.konflikt)
   or (p.offen and (p.status = 'manuell prüfen' or p.konflikt))
order by 1 desc, 2, 3;

rollback;

-- Nur lesend: dieselbe Auswahl (nach dem Rollback ist nichts geändert)
with land_map(eingabe, code) as (
  values
    ('deutschland','DE'),('germany','DE'),('de','DE'),('d','DE'),('brd','DE'),('bundesrepublik deutschland','DE'),
    ('österreich','AT'),('oesterreich','AT'),('austria','AT'),('at','AT'),('a','AT'),
    ('schweiz','CH'),('switzerland','CH'),('ch','CH'),
    ('niederlande','NL'),('holland','NL'),('netherlands','NL'),('nl','NL'),
    ('belgien','BE'),('belgium','BE'),('be','BE'),
    ('luxemburg','LU'),('luxembourg','LU'),('lu','LU'),
    ('frankreich','FR'),('france','FR'),('fr','FR'),
    ('dänemark','DK'),('daenemark','DK'),('denmark','DK'),('dk','DK'),
    ('polen','PL'),('poland','PL'),('pl','PL'),
    ('tschechien','CZ'),('tschechische republik','CZ'),('czech republic','CZ'),('cz','CZ'),
    ('italien','IT'),('italy','IT'),('it','IT'),
    ('spanien','ES'),('spain','ES'),('es','ES'),
    ('schweden','SE'),('sweden','SE'),('se','SE'),
    ('norwegen','NO'),('norway','NO'),('no','NO'),
    ('vereinigtes königreich','GB'),('großbritannien','GB'),('united kingdom','GB'),('uk','GB'),('gb','GB')
),
quellen as (
  -- ist_*: heutiger Inhalt der Zielfelder (leer = NULL)
  select 'Rechnungsadresse'::text as quelle, ra.id,
         a.name || ' — ' || coalesce(ra.firma, '') as empfaenger,
         btrim(coalesce(ra.plz_ort, '')) as plz_ort_bisher,
         null::text as plz_bisher, null::text as ort_bisher,
         btrim(coalesce(ra.land, '')) as land_bisher,
         nullif(btrim(coalesce(ra.plz, '')), '') as ist_plz,
         nullif(btrim(coalesce(ra.ort, '')), '') as ist_ort,
         nullif(btrim(coalesce(ra.land_code, '')), '') as ist_land
    from public.rechnungsadressen ra
    join public.auftraggeber a on a.id = ra.auftraggeber_id
  union all
  select 'Auftraggeber', a.id, a.name,
         btrim(concat_ws(' ', nullif(btrim(a.plz), ''), nullif(btrim(a.ort), ''))),
         btrim(coalesce(a.plz, '')), btrim(coalesce(a.ort, '')), '',
         null, null, nullif(btrim(coalesce(a.land_code, '')), '')
    from public.auftraggeber a
  union all
  select 'Manueller Empfänger', m.id,
         coalesce(nullif(btrim(m.firma), ''), btrim(concat_ws(' ', m.vorname, m.nachname))),
         btrim(concat_ws(' ', nullif(btrim(m.plz), ''), nullif(btrim(m.ort), ''))),
         btrim(coalesce(m.plz, '')), btrim(coalesce(m.ort, '')),
         btrim(coalesce(m.land, '')),
         null, null, nullif(btrim(coalesce(m.land_code, '')), '')
    from public.manuelle_empfaenger m
),
geparst as (
  -- Regeln exakt wie erechnung_adressen_probelauf.sql
  select q.*,
         case
           when q.land_bisher = '' then 'DE'
           else (select lm.code from land_map lm where lm.eingabe = lower(q.land_bisher))
         end as land_vorschlag,
         case
           when q.plz_bisher is not null then q.plz_bisher
           when q.plz_ort_bisher ~ '^[0-9]{5}\s+\S' then substring(q.plz_ort_bisher from '^([0-9]{5})')
           when q.plz_ort_bisher ~* '^D\s*-?\s*[0-9]{5}\s+\S' then substring(q.plz_ort_bisher from '([0-9]{5})')
         end as plz_vorschlag,
         case
           when q.ort_bisher is not null then q.ort_bisher
           when q.plz_ort_bisher ~ '^[0-9]{5}\s+\S' then btrim(regexp_replace(q.plz_ort_bisher, '^[0-9]{5}\s+', ''))
           when q.plz_ort_bisher ~* '^D\s*-?\s*[0-9]{5}\s+\S' then btrim(regexp_replace(q.plz_ort_bisher, '^[Dd]\s*-?\s*[0-9]{5}\s+', ''))
         end as ort_vorschlag
    from quellen q
),
bewertet as (
  select g.*,
    case
      when plz_ort_bisher = ''                                              then 'manuell prüfen'
      when land_vorschlag is null                                           then 'manuell prüfen'
      when plz_vorschlag is null or coalesce(ort_vorschlag, '') = ''        then 'manuell prüfen'
      when land_vorschlag = 'DE' and plz_vorschlag !~ '^[0-9]{5}$'          then 'manuell prüfen'
      when land_vorschlag <> 'DE'                                           then 'manuell prüfen'
      when ort_vorschlag ~ '[0-9]'                                          then 'manuell prüfen'
      else 'eindeutig'
    end as status,
    concat_ws('; ',
      case when plz_ort_bisher = '' then 'keine PLZ/Ort hinterlegt' end,
      case when land_bisher = '' then 'Land leer → Standard DE' end,
      case when land_vorschlag is null then 'Land „' || land_bisher || '" nicht zugeordnet' end,
      case when land_vorschlag is not null and land_vorschlag <> 'DE' then 'Ausland — PLZ-Format bitte prüfen' end,
      case when plz_ort_bisher ~* '^D\s*-?\s*[0-9]{5}' then 'Präfix „D-" entfernt' end,
      case when plz_vorschlag is null and plz_ort_bisher <> '' then 'Format nicht erkannt' end,
      case when land_vorschlag = 'DE' and plz_vorschlag is not null and plz_vorschlag !~ '^[0-9]{5}$' then 'keine 5-stellige deutsche PLZ' end,
      case when ort_vorschlag ~ '[0-9]' then 'Ziffern im Ort' end
    ) as hinweis
  from geparst g
),
plan as (
  select b.*,
    -- noch etwas zu tun? (Auftraggeber/Manuelle Empfänger: nur der Land-Code;
    -- PLZ/Ort sind dort schon getrennte Felder)
    case when b.quelle = 'Rechnungsadresse' then (b.ist_plz is null or b.ist_ort is null or b.ist_land is null)
         else b.ist_land is null end as offen,
    -- ein bereits gefülltes Feld weicht vom Vorschlag ab → nichts schreiben
    (b.ist_plz is not null and b.ist_plz is distinct from b.plz_vorschlag)
      or (b.ist_ort is not null and b.ist_ort is distinct from b.ort_vorschlag)
      or (b.ist_land is not null and b.ist_land is distinct from b.land_vorschlag) as konflikt
  from bewertet b
),
schreiben as (
  select * from plan where status = 'eindeutig' and offen and not konflikt
)
select
  case
    when p.status = 'eindeutig' and p.offen and not p.konflikt then 'würde geschrieben'
    else 'manuell prüfen' end                                                   as "Ergebnis",
  p.quelle                                                as "Quelle",
  p.empfaenger                                            as "Empfänger",
  p.plz_ort_bisher                                        as "bisher PLZ/Ort",
  nullif(p.land_bisher, '')                               as "bisher Land",
  case when p.quelle = 'Rechnungsadresse' then coalesce(p.ist_plz, p.plz_vorschlag) end as "PLZ",
  case when p.quelle = 'Rechnungsadresse' then coalesce(p.ist_ort, p.ort_vorschlag) end as "Ort",
  coalesce(p.ist_land, p.land_vorschlag)                  as "Land-Code",
  concat_ws('; ', nullif(p.hinweis, ''),
    case when p.konflikt then 'bereits gefülltes Feld weicht vom Vorschlag ab — nichts geschrieben' end) as "Hinweis",
  p.id                                                    as "Datensatz-ID"
from plan p
where (p.status = 'eindeutig' and p.offen and not p.konflikt)
   or (p.offen and (p.status = 'manuell prüfen' or p.konflikt))
order by 1 desc, 2, 3;
