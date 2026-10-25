begin;

update public."allShowtimes"
set screening_city = case screening_city
  when 'HOT CINEMA גרנד חיפה' then 'Haifa'
  when 'HOT CINEMA קריון קרית ביאליק' then 'Kiryat Bialik'
  when 'HOT CINEMA DREAM STAGE חולון' then 'Holon'
  when 'HOT CINEMA DREAM STAGE' then 'Holon'
end
where cinema = 'Hot Cinema'
  and screening_city in (
    'HOT CINEMA גרנד חיפה',
    'HOT CINEMA קריון קרית ביאליק',
    'HOT CINEMA DREAM STAGE חולון',
    'HOT CINEMA DREAM STAGE'
  );

update public."finalShowtimes"
set screening_city = case screening_city
  when 'HOT CINEMA גרנד חיפה' then 'Haifa'
  when 'HOT CINEMA קריון קרית ביאליק' then 'Kiryat Bialik'
  when 'HOT CINEMA DREAM STAGE חולון' then 'Holon'
  when 'HOT CINEMA DREAM STAGE' then 'Holon'
end
where cinema = 'Hot Cinema'
  and screening_city in (
    'HOT CINEMA גרנד חיפה',
    'HOT CINEMA קריון קרית ביאליק',
    'HOT CINEMA DREAM STAGE חולון',
    'HOT CINEMA DREAM STAGE'
  );

commit;
