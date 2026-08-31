-- Migration 094: Adress-Pool blockweise bereinigen (RPC) + Normalisierung
-- schon beim Schreiben.
--
-- Warum blockweise?
-- -----------------
-- Der einmalige Gesamtdurchlauf in 093 hat im SQL-Editor die Verbindung
-- überdauert („Failed to fetch"). Ursache war nicht die Datenmenge an
-- sich, sondern der quadratische Aufwand: für JEDE Wertgruppe wurde die
-- komplette Tabelle noch einmal durch die Normalisierungs-Funktion
-- geschickt.
--
-- Hier läuft beides mengenbasiert und mit Obergrenze pro Aufruf. Die
-- Oberfläche ruft die RPC so lange auf, bis nichts mehr offen ist —
-- jeder einzelne Aufruf bleibt weit innerhalb jedes Timeouts.
--
-- Zusätzlich normalisiert die Sammel-RPC ihre Werte jetzt selbst. Damit
-- kommen keine neuen Kleinschreibungen mehr dazu, unabhängig davon,
-- welche Frontend-Version gerade im Browser liegt.

-- ------------------------------------------------------------
-- 1. Status — was ist noch offen?
--
--    Wird für die Fortschrittsanzeige und für das Prüfskript benutzt.
--    Nur lesend; Admin-only, weil der Pool Auftraggebern nicht zusteht.
-- ------------------------------------------------------------
create or replace function public.adress_pool_status()
returns table (
  eintraege_gesamt      int,
  offen_schreibweise    int,
  duplikat_gruppen      int,
  duplikat_ueberzaehlig int,
  adressbuch_offen      int
)
language sql
stable
security definer
set search_path = public
as $$
  with normalisiert as (
    select
      id, feld_typ, wert,
      public.maja_vorschlag_schreibweise(feld_typ, wert) as neu
    from public.feld_vorschlaege
  ),
  gruppen as (
    select feld_typ, lower(neu) as schluessel, count(*) as n
    from normalisiert
    group by 1, 2
    having count(*) > 1
  )
  select
    (select count(*) from normalisiert)::int,
    (select count(*) from normalisiert where wert is distinct from neu)::int,
    (select count(*) from gruppen)::int,
    (select coalesce(sum(n - 1), 0) from gruppen)::int,
    (select count(*) from public.adressbuch a
      where a.bezeichnung is distinct from public.maja_gross_anfang(a.bezeichnung)
         or a.strasse     is distinct from public.maja_gross_anfang(a.strasse)
         or a.ort         is distinct from public.maja_gross_anfang(a.ort))::int
  where public.is_admin();
$$;

revoke all on function public.adress_pool_status() from public;
grant execute on function public.adress_pool_status() to authenticated;

-- ------------------------------------------------------------
-- 2. Bereinigung — ein Block pro Aufruf
--
--    Reihenfolge innerhalb eines Aufrufs:
--      a) Dubletten zusammenführen (Häufigkeiten addieren, jüngste
--         Nutzung behalten, überzählige Zeilen löschen)
--      b) verbleibende Zeilen auf die richtige Schreibweise bringen
--      c) Adressbuch nachziehen
--
--    (a) vor (b), weil ein Umbenennen sonst in die Unique-Bedingung
--    (feld_typ, wert) laufen könnte. (b) überspringt zur Sicherheit
--    zusätzlich alles, was kollidieren würde.
--
--    Mehrfach aufrufbar: ist nichts mehr offen, ändert der Aufruf
--    nichts und meldet 0.
-- ------------------------------------------------------------
create or replace function public.adress_pool_bereinigen(p_limit int default 500)
returns table (
  zusammengefuehrt int,
  umbenannt        int,
  adressbuch       int,
  offen            int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_merge int := 0;
  v_ren   int := 0;
  v_adr   int := 0;
  v_limit int := greatest(1, least(coalesce(p_limit, 500), 5000));
begin
  if not public.is_admin() then
    raise exception 'Nur Administratoren dürfen den Adress-Pool bereinigen.';
  end if;

  -- ---- a) Dubletten ----
  with gruppen as (
    select feld_typ, lower(public.maja_vorschlag_schreibweise(feld_typ, wert)) as schluessel
    from public.feld_vorschlaege
    group by 1, 2
    having count(*) > 1
    limit v_limit
  ),
  zeilen as (
    select f.id, f.feld_typ, f.anzahl, f.letzte_nutzung, f.ist_manuell, g.schluessel
    from public.feld_vorschlaege f
    join gruppen g
      on g.feld_typ = f.feld_typ
     and g.schluessel = lower(public.maja_vorschlag_schreibweise(f.feld_typ, f.wert))
  ),
  ziel as (
    select
      feld_typ, schluessel,
      -- Behalten wird der manuell gepflegte bzw. häufigste Eintrag;
      -- die id als letztes Kriterium macht den Lauf reproduzierbar.
      (array_agg(id order by ist_manuell desc, anzahl desc, id))[1] as behalten,
      sum(anzahl)::int    as summe,
      max(letzte_nutzung) as letzte,
      bool_or(ist_manuell) as manuell
    from zeilen
    group by feld_typ, schluessel
  ),
  uebernommen as (
    update public.feld_vorschlaege fv
       set anzahl         = z.summe,
           letzte_nutzung = z.letzte,
           ist_manuell    = z.manuell
      from ziel z
     where fv.id = z.behalten
    returning fv.id
  ),
  entfernt as (
    delete from public.feld_vorschlaege fv
     using zeilen zl
     join  ziel   z on z.feld_typ = zl.feld_typ and z.schluessel = zl.schluessel
     where fv.id = zl.id
       and fv.id <> z.behalten
    returning fv.id
  )
  select count(*)::int into v_merge from entfernt;

  -- ---- b) Schreibweise ----
  with kandidaten as (
    select id, feld_typ,
           public.maja_vorschlag_schreibweise(feld_typ, wert) as neu
    from public.feld_vorschlaege
    where wert is distinct from public.maja_vorschlag_schreibweise(feld_typ, wert)
    limit v_limit
  )
  update public.feld_vorschlaege fv
     set wert = k.neu
    from kandidaten k
   where fv.id = k.id
     -- Kollisionen bleiben liegen; sie verschwinden im nächsten Aufruf
     -- über Schritt (a).
     and not exists (
       select 1 from public.feld_vorschlaege x
        where x.feld_typ = k.feld_typ and x.wert = k.neu and x.id <> k.id
     );
  get diagnostics v_ren = row_count;

  -- ---- c) Adressbuch ----
  with kandidaten as (
    select id from public.adressbuch a
     where a.bezeichnung is distinct from public.maja_gross_anfang(a.bezeichnung)
        or a.strasse     is distinct from public.maja_gross_anfang(a.strasse)
        or a.ort         is distinct from public.maja_gross_anfang(a.ort)
     limit v_limit
  )
  update public.adressbuch a
     set bezeichnung = public.maja_gross_anfang(a.bezeichnung),
         strasse     = public.maja_gross_anfang(a.strasse),
         ort         = public.maja_gross_anfang(a.ort)
    from kandidaten k
   where a.id = k.id;
  get diagnostics v_adr = row_count;

  zusammengefuehrt := v_merge;
  umbenannt        := v_ren;
  adressbuch       := v_adr;
  select s.offen_schreibweise + s.duplikat_ueberzaehlig + s.adressbuch_offen
    into offen
    from public.adress_pool_status() s;
  return next;
end;
$$;

revoke all on function public.adress_pool_bereinigen(int) from public;
grant execute on function public.adress_pool_bereinigen(int) to authenticated;

-- ------------------------------------------------------------
-- 3. Neue Werte gleich richtig speichern
--
--    Bisher übernahm die RPC die zuerst gespeicherte Schreibweise. Damit
--    blieb „bremen" für immer „bremen", auch wenn später „Bremen"
--    gemeldet wurde. Jetzt wird der eingehende Wert normalisiert und ein
--    vorhandener Eintrag nur dann als Schreibweise übernommen, wenn er
--    selbst schon normalisiert ist.
--
--    Damit hängt die einheitliche Schreibweise nicht mehr allein am
--    Frontend (Punkt e).
-- ------------------------------------------------------------
create or replace function public.feld_vorschlaege_merken(p_eintraege jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role      text;
  v_typ       text;
  v_wert      text;
  v_bestehend text;
  v_count     int := 0;
  rec         jsonb;
begin
  select role into v_role from public.app_users where id = auth.uid();
  -- Auftraggeber: kein Zugriff auf den Pool. Test: darf lesen, nicht
  -- schreiben. Unbekannte/abgemeldete Nutzer ebenfalls nicht.
  if v_role is null or v_role in ('auftraggeber', 'test') then
    return 0;
  end if;
  if jsonb_typeof(p_eintraege) <> 'array' then
    return 0;
  end if;

  for rec in select * from jsonb_array_elements(p_eintraege) loop
    v_typ  := nullif(btrim(rec ->> 'feld_typ'), '');
    v_wert := nullif(btrim(regexp_replace(coalesce(rec ->> 'wert', ''), '\s+', ' ', 'g')), '');
    if v_typ is null or v_wert is null then continue; end if;
    -- Sehr kurze Werte (Tippfehler, "ok", "-") nicht sammeln.
    if char_length(v_wert) < 3 or char_length(v_wert) > 200 then continue; end if;

    -- Einheitliche Schreibweise, bevor irgendetwas verglichen wird.
    v_wert := public.maja_vorschlag_schreibweise(v_typ, v_wert);

    -- Gibt es den Wert schon in anderer Schreibweise? Dann diesen
    -- Eintrag hochzählen statt einen zweiten anzulegen — aber NUR, wenn
    -- der vorhandene Eintrag bereits die richtige Schreibweise hat.
    -- Sonst würde eine alte Kleinschreibung ewig fortgeschrieben.
    select fv.wert into v_bestehend
      from public.feld_vorschlaege fv
     where fv.feld_typ = v_typ
       and lower(fv.wert) = lower(v_wert)
       and fv.wert = public.maja_vorschlag_schreibweise(fv.feld_typ, fv.wert)
     limit 1;
    if v_bestehend is not null then v_wert := v_bestehend; end if;

    insert into public.feld_vorschlaege (feld_typ, wert)
    values (v_typ, v_wert)
    on conflict (feld_typ, wert) do update
      set anzahl         = public.feld_vorschlaege.anzahl + 1,
          letzte_nutzung = now();
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.feld_vorschlaege_merken(jsonb) from public;
grant execute on function public.feld_vorschlaege_merken(jsonb) to authenticated;

notify pgrst, 'reload schema';
