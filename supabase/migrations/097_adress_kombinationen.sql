-- Migration 097: Adress-Kombinationen — welche Straße gehört zu welcher
-- PLZ und welchem Ort?
--
-- Nach dem Zerlegen (096) steht im Pool nur noch der reine Straßenteil.
-- Das ist richtig so — aber damit ging die ZUORDNUNG verloren: bei der
-- Auswahl einer Straße wusste niemand mehr, welche PLZ und welcher Ort
-- dazugehören.
--
-- Diese Tabelle merkt sich genau das. Sie tritt NICHT an die Stelle des
-- Pools: der getrennte Topf (Straße / PLZ / Ort) bleibt unverändert, die
-- Kombinationen kommen ergänzend dazu.
--
-- Abgrenzung zum Adressbuch (090): dort pflegt der Admin Adressen von
-- Hand, mit Bezeichnung und optionaler Auftraggeber-Zuordnung. Hier
-- entsteht alles automatisch aus dem, was tatsächlich eingetragen wird —
-- dieselbe Trennung wie zwischen Adressbuch und Vorschlags-Pool.

-- ------------------------------------------------------------
-- 1. Tabelle
--
--    Eingetragen wird nur, wenn ALLE DREI Teile dastehen — eine
--    Kombination ohne PLZ oder Ort trägt keine Information, die der
--    Pool nicht schon hätte. Die Spalten bleiben trotzdem nullable, wie
--    vorgegeben; die Vollständigkeit erzwingen RPC und Backfill.
-- ------------------------------------------------------------
create table if not exists public.adress_kombinationen (
  id             uuid primary key default gen_random_uuid(),
  strasse        text not null,
  plz            text,
  ort            text,
  anzahl         int default 1,
  letzte_nutzung timestamptz default now(),
  created_at     timestamptz default now(),
  unique (strasse, plz, ort)
);

comment on table public.adress_kombinationen is
  'Automatisch gesammelte Zuordnung Straße → PLZ → Ort. Füllt bei der '
  'Auswahl einer Straße alle drei Adressfelder gemeinsam. Ergänzt den '
  'Vorschlags-Pool, ersetzt ihn nicht.';

-- Nachschlagen läuft immer über die Straße — und zwar über den
-- Vergleichsschlüssel, damit „Bahnhofstr. 5" auch die Kombination zu
-- „Bahnhofstraße 5" findet.
create index if not exists idx_adress_kombi_strasse
  on public.adress_kombinationen (public.maja_vergleichsschluessel(strasse));

-- ------------------------------------------------------------
-- 2. RLS — wie beim übrigen Pool
--
--    Lesen: alle angemeldeten Rollen AUSSER Auftraggeber.
--    Schreiben: ausschließlich über die RPC unten (kein insert/update-
--    Grant), Pflege und Löschen nur für Admins. Test-Profile lesen
--    mit, schreiben aber nicht — das regelt die RPC.
-- ------------------------------------------------------------
alter table public.adress_kombinationen enable row level security;

drop policy if exists ak_read on public.adress_kombinationen;
create policy ak_read on public.adress_kombinationen
  for select using (not public.is_auftraggeber());

drop policy if exists ak_admin_update on public.adress_kombinationen;
create policy ak_admin_update on public.adress_kombinationen
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists ak_admin_delete on public.adress_kombinationen;
create policy ak_admin_delete on public.adress_kombinationen
  for delete using (public.is_admin());

grant select, update, delete on public.adress_kombinationen to authenticated;

-- ------------------------------------------------------------
-- 3. Schreib-RPC
--
--    Nimmt [{strasse, plz, ort}, …] entgegen. Normalisiert wie der Pool
--    (Schreibweise, Leerzeichen) und zählt bestehende Kombinationen
--    hoch. Auftraggeber und Test-Profile laufen wirkungslos durch —
--    kein Fehler, damit ein Formular im Testmodus normal absendbar
--    bleibt.
--
--    Dubletten werden über den Vergleichsschlüssel erkannt: existiert
--    „Bahnhofstraße 5 / 28195 / Bremen" schon, zählt eine gemeldete
--    „Bahnhofstr. 5 / 28195 / Bremen" diese Zeile hoch, statt eine
--    zweite anzulegen.
-- ------------------------------------------------------------
create or replace function public.adress_kombination_merken(p_kombis jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    text;
  v_strasse text;
  v_plz     text;
  v_ort     text;
  v_id      uuid;
  v_count   int := 0;
  rec       jsonb;
begin
  select role into v_role from public.app_users where id = auth.uid();
  if v_role is null or v_role in ('auftraggeber', 'test') then
    return 0;
  end if;
  if jsonb_typeof(p_kombis) <> 'array' then
    return 0;
  end if;

  for rec in select * from jsonb_array_elements(p_kombis) loop
    v_strasse := nullif(btrim(regexp_replace(coalesce(rec ->> 'strasse', ''), '\s+', ' ', 'g'), ' ,;'), '');
    v_plz     := nullif(btrim(coalesce(rec ->> 'plz', ''), ' ,;'), '');
    v_ort     := nullif(btrim(regexp_replace(coalesce(rec ->> 'ort', ''), '\s+', ' ', 'g'), ' ,;'), '');
    -- Nur vollständige Kombinationen — alles andere steht ohnehin im Pool.
    if v_strasse is null or v_plz is null or v_ort is null then continue; end if;
    if char_length(v_strasse) > 200 or char_length(v_ort) > 200 then continue; end if;
    -- Eine Straße mit PLZ darin wäre eine unzerlegte Gesamtadresse.
    if public.maja_ist_gesamtadresse(v_strasse) then continue; end if;

    v_strasse := public.maja_vorschlag_schreibweise('adresse_strasse', v_strasse);
    v_ort     := public.maja_vorschlag_schreibweise('adresse_stadt', v_ort);

    -- Gibt es die Kombination schon in anderer Schreibweise?
    select k.id into v_id
      from public.adress_kombinationen k
     where public.maja_vergleichsschluessel(k.strasse) = public.maja_vergleichsschluessel(v_strasse)
       and coalesce(k.plz, '') = v_plz
       and public.maja_vergleichsschluessel(coalesce(k.ort, '')) = public.maja_vergleichsschluessel(v_ort)
     limit 1;

    if v_id is not null then
      update public.adress_kombinationen
         set anzahl = coalesce(anzahl, 0) + 1, letzte_nutzung = now()
       where id = v_id;
    else
      insert into public.adress_kombinationen (strasse, plz, ort)
      values (v_strasse, v_plz, v_ort)
      on conflict (strasse, plz, ort) do update
        set anzahl = coalesce(public.adress_kombinationen.anzahl, 0) + 1,
            letzte_nutzung = now();
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.adress_kombination_merken(jsonb) from public;
grant execute on function public.adress_kombination_merken(jsonb) to authenticated;

notify pgrst, 'reload schema';
