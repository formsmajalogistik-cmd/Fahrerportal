-- ============================================================
-- Maja-Logistik Business-Portal — 014: Auto-Preis + ABA + Sondervereinbarung
-- ------------------------------------------------------------
-- 1. ABA-Aufschlag pro Auftraggeber
-- 2. Sondervereinbarung als Boolean-Flag (Freitext bleibt erhalten)
-- 3. RPC calculate_tour_price(auftraggeber_id, km, tourenart)
-- ============================================================

-- ------------------------------------------------------------
-- auftraggeber: ABA-Aufschlag in Prozent
-- ------------------------------------------------------------
alter table public.auftraggeber
  add column if not exists aba_aufschlag_prozent decimal(5,2);

-- ------------------------------------------------------------
-- touren: Sondervereinbarung-Flag
-- ------------------------------------------------------------
alter table public.touren
  add column if not exists ist_sondervereinbarung boolean not null default false;

-- ------------------------------------------------------------
-- calculate_tour_price(auftraggeber_id, km, tourenart) → preis
--
-- Schlägt den Preis aus preisstufen für den passenden km-Bereich nach.
-- Bei Tourenart 'ABA' wird der ABA-Aufschlag des Auftraggebers
-- aufgeschlagen (sofern > 0). Liefert NULL, wenn keine Stufe matcht
-- oder Pflicht-Parameter fehlen.
-- ------------------------------------------------------------
create or replace function public.calculate_tour_price(
  p_auftraggeber_id uuid,
  p_km              integer,
  p_tourenart       text default 'AB'
)
returns decimal
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_preis     decimal;
  v_aufschlag decimal;
begin
  if p_auftraggeber_id is null or p_km is null then
    return null;
  end if;

  select preis into v_preis
    from public.preisstufen
   where auftraggeber_id = p_auftraggeber_id
     and p_km >= km_von
     and p_km <= km_bis
   order by km_von
   limit 1;

  if v_preis is null then
    return null;
  end if;

  if p_tourenart = 'ABA' then
    select aba_aufschlag_prozent into v_aufschlag
      from public.auftraggeber
     where id = p_auftraggeber_id;
    if v_aufschlag is not null and v_aufschlag > 0 then
      return round(v_preis + v_preis * v_aufschlag / 100.0, 2);
    end if;
  end if;

  return v_preis;
end;
$$;

grant execute on function public.calculate_tour_price(uuid, integer, text) to authenticated;
