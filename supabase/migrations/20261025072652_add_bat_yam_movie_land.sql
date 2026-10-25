begin;

insert into public.cities (
  name,
  alt_spellings,
  zoom_layer,
  latitude,
  longitude,
  neighboring_cities
)
values (
  'Bat Yam',
  array['Bat Yam', 'Bat-Yam', 'בת ים', 'בת-ים']::text[],
  9.5,
  32.02379,
  34.75185,
  array['Holon', 'Tel Aviv', 'Rishon Letzion']::text[]
)
on conflict (name) do update set
  alt_spellings = excluded.alt_spellings,
  zoom_layer = excluded.zoom_layer,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  neighboring_cities = excluded.neighboring_cities;

insert into public.theaters (
  location,
  chain,
  address,
  latitude,
  longitude,
  theater_name,
  city_name
)
values (
  'https://www.google.com/maps/search/?api=1&query=MovieLand+Yoseftal+92+Bat+Yam+Israel',
  'MovieLand',
  'Yoseftal Street 92, BIG FASHION Bat Yam',
  32.0154,
  34.755163,
  'MovieLand Bat Yam',
  'Bat Yam'
)
on conflict (location) do update set
  chain = excluded.chain,
  address = excluded.address,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  theater_name = excluded.theater_name,
  city_name = excluded.city_name;

update public."allShowtimes"
set screening_city = 'Bat Yam'
where cinema = 'MovieLand'
  and screening_city = 'בת ים';

update public."finalShowtimes"
set screening_city = 'Bat Yam'
where cinema = 'MovieLand'
  and screening_city = 'בת ים';

alter table public.ticket_alert_preferences
  drop constraint if exists ticket_alert_preferences_cities_check;

alter table public.ticket_alert_preferences
  add constraint ticket_alert_preferences_cities_check check (
    cities is null or (
      cities <@ array[
        'Afula','Ashdod','Ashkelon','Ayalon','Bat Yam','Beer Sheva','Carmiel',
        'Chadera','Even Yehuda','Givatayim','Glilot','Haifa','Herziliya',
        'Jerusalem','Kfar Saba','Kiryat Bialik','Kiryat Ono','Modiin',
        'Nahariya','Netanya','Omer','Petach Tikvah','Raanana',
        'Ramat Hasharon','Rehovot','Rishon Letzion','Tel Aviv',
        'Zichron Yaakov','Holon'
      ]::text[]
      and array_position(cities, null) is null
    )
  );

commit;
