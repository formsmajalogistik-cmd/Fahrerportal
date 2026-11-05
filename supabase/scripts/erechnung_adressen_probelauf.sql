-- E-Rechnung: PLZ/Ort trennen + Land → ISO-Code — PROBELAUF, NUR LESEN.
--
-- Erst NACH Migration 115 ausführen (braucht die neuen Spalten nicht,
-- zeigt sie aber mit an). Es wird NICHTS geschrieben. Das Ergebnis ist
-- ein Vorschlag je Empfänger; übernommen wird erst nach Bestätigung
-- (eigenes Skript, folgt dann).
--
-- Geprüft werden die Stammdaten:
--   * Rechnungsadressen der Auftraggeber  (plz_ort kombiniert, land Freitext)
--   * Auftraggeber                        (plz/ort schon getrennt; nur Land)
--   * Manuelle Empfänger                  (plz/ort schon getrennt; land Freitext)
-- NICHT angefasst: Snapshots erstellter Rechnungen/Gutschriften, Tourdaten.
--
-- Regeln (bewusst vorsichtig — alles Unklare = „manuell prüfen"):
--   * „28816 Stuhr"          → PLZ 28816, Ort Stuhr       (eindeutig, wenn Land leer/DE)
--   * „D-28816 Stuhr"        → PLZ 28816, Ort Stuhr       (eindeutig, Hinweis „D-" entfernt)
--   * 4-stellige PLZ, „A-1010 Wien", „NL 1234 AB …" usw. → manuell prüfen
--   * Land: Deutschland/Germany/DE/D → DE, Österreich → AT, … ;
--     leer → DE (Standard), alles andere → manuell prüfen
--   * PLZ (DE) passt nicht zum Land, oder Land ≠ DE bei deutscher PLZ → manuell prüfen

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
  -- Rechnungsadressen: kombiniertes plz_ort
  select 'Rechnungsadresse'::text as quelle, ra.id,
         a.name || ' — ' || coalesce(ra.firma, '') as empfaenger,
         btrim(coalesce(ra.plz_ort, '')) as plz_ort_bisher,
         null::text as plz_bisher, null::text as ort_bisher,
         btrim(coalesce(ra.land, '')) as land_bisher
    from public.rechnungsadressen ra
    join public.auftraggeber a on a.id = ra.auftraggeber_id
  union all
  -- Auftraggeber: plz/ort getrennt, kein Land-Feld
  select 'Auftraggeber', a.id, a.name,
         btrim(concat_ws(' ', nullif(btrim(a.plz), ''), nullif(btrim(a.ort), ''))),
         btrim(coalesce(a.plz, '')), btrim(coalesce(a.ort, '')), ''
    from public.auftraggeber a
  union all
  -- Manuelle Empfänger: plz/ort getrennt, land Freitext
  select 'Manueller Empfänger', m.id,
         coalesce(nullif(btrim(m.firma), ''), btrim(concat_ws(' ', m.vorname, m.nachname))),
         btrim(concat_ws(' ', nullif(btrim(m.plz), ''), nullif(btrim(m.ort), ''))),
         btrim(coalesce(m.plz, '')), btrim(coalesce(m.ort, '')),
         btrim(coalesce(m.land, ''))
    from public.manuelle_empfaenger m
),
geparst as (
  select q.*,
         -- Land
         case
           when q.land_bisher = '' then 'DE'
           else (select lm.code from land_map lm where lm.eingabe = lower(q.land_bisher))
         end as land_vorschlag,
         case
           when q.plz_bisher is not null then q.plz_bisher                                     -- schon getrennt
           when q.plz_ort_bisher ~ '^[0-9]{5}\s+\S' then substring(q.plz_ort_bisher from '^([0-9]{5})')
           when q.plz_ort_bisher ~* '^D\s*-?\s*[0-9]{5}\s+\S' then substring(q.plz_ort_bisher from '([0-9]{5})')
         end as plz_vorschlag,
         case
           when q.ort_bisher is not null then q.ort_bisher
           when q.plz_ort_bisher ~ '^[0-9]{5}\s+\S' then btrim(regexp_replace(q.plz_ort_bisher, '^[0-9]{5}\s+', ''))
           when q.plz_ort_bisher ~* '^D\s*-?\s*[0-9]{5}\s+\S' then btrim(regexp_replace(q.plz_ort_bisher, '^[Dd]\s*-?\s*[0-9]{5}\s+', ''))
         end as ort_vorschlag
    from quellen q
)
select
  quelle                                      as "Quelle",
  empfaenger                                  as "Empfänger",
  plz_ort_bisher                              as "bisher PLZ/Ort",
  nullif(land_bisher, '')                     as "bisher Land",
  plz_vorschlag                               as "Vorschlag PLZ",
  ort_vorschlag                               as "Vorschlag Ort",
  land_vorschlag                              as "Vorschlag Land-Code",
  case
    when plz_ort_bisher = ''                                              then 'manuell prüfen'
    when land_vorschlag is null                                           then 'manuell prüfen'
    when plz_vorschlag is null or coalesce(ort_vorschlag, '') = ''        then 'manuell prüfen'
    when land_vorschlag = 'DE' and plz_vorschlag !~ '^[0-9]{5}$'          then 'manuell prüfen'
    when land_vorschlag <> 'DE'                                           then 'manuell prüfen'
    when ort_vorschlag ~ '[0-9]'                                          then 'manuell prüfen'
    else 'eindeutig'
  end                                         as "Status",
  concat_ws('; ',
    case when plz_ort_bisher = '' then 'keine PLZ/Ort hinterlegt' end,
    case when land_bisher = '' then 'Land leer → Standard DE' end,
    case when land_vorschlag is null then 'Land „' || land_bisher || '" nicht zugeordnet' end,
    case when land_vorschlag is not null and land_vorschlag <> 'DE' then 'Ausland — PLZ-Format bitte prüfen' end,
    case when plz_ort_bisher ~* '^D\s*-?\s*[0-9]{5}' then 'Präfix „D-" entfernt' end,
    case when plz_vorschlag is null and plz_ort_bisher <> '' then 'Format nicht erkannt' end,
    case when land_vorschlag = 'DE' and plz_vorschlag is not null and plz_vorschlag !~ '^[0-9]{5}$' then 'keine 5-stellige deutsche PLZ' end,
    case when ort_vorschlag ~ '[0-9]' then 'Ziffern im Ort' end
  )                                           as "Hinweis",
  id                                          as "Datensatz-ID"
from geparst
order by "Status" desc, "Quelle", "Empfänger";
