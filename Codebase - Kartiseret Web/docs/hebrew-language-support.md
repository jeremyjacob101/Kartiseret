# Hebrew language support

Kartiseret supports English (`en`, LTR) and Hebrew (`he`, RTL) as a device-level preference. The selector works before authentication, while signed in, and on the preferences page.

## Runtime behavior

- The selected locale is stored as `kartiseret_locale_v1` in `localStorage`.
- The pre-render script in `index.html` applies `<html lang>` and `<html dir>` before React starts, preventing an LTR flash when Hebrew is saved.
- `I18nProvider` updates language, direction, page metadata, React copy, dates, and accessibility labels together.
- Locale changes are broadcast in the current tab and synchronized to other tabs through the browser `storage` event.
- New-account metadata includes `signup_locale`. The active preference remains device-local so guests and signed-in users use exactly the same immediate toggle and a failed account request can never block language switching.
- Canonical routing and data keys stay in English. For example, `Jerusalem` remains the showtime query key while the UI displays `ירושלים`.
- The responsive device layer treats mobile user agents and viewports up to 699 px as mobile, and updates live on resize. This keeps the RTL mobile layout active in narrow desktop windows as well as on phones.

## Adding interface copy

1. Add the English key to `src/i18n/messages.ts`.
2. Add the same key to `hebrewMessages`. TypeScript requires the two dictionaries to remain complete.
3. Call `t("new.key")`, using interpolation values for dynamic text.
4. Use `dir="auto"` for content that can fall back to English, and `dir="ltr"` for email addresses, times, IDs, and URLs.

Do not branch layout code just to reverse rows. Prefer CSS logical properties such as `margin-inline-start`, `padding-inline`, `border-inline-start`, and `inset-inline-end`. Carousels and date rails deliberately keep an LTR scrolling coordinate system while their visible content inherits the active language direction.

## Movie content contract

The current tables are read progressively, so deployment is safe before every localized column exists:

- `finalMovies.hebrew_title` and `finalSoons.hebrew_title` provide Hebrew titles when populated.
- An optional JSON/JSONB `localized_content` column supplies the remaining localized fields.
- `finalShowtimes.hebrew_href` supplies a Hebrew ticket page when available.

Suggested Supabase migration when those columns are ready:

```sql
alter table "finalMovies"
  add column if not exists hebrew_title text,
  add column if not exists localized_content jsonb;

alter table "finalSoons"
  add column if not exists hebrew_title text,
  add column if not exists localized_content jsonb;

alter table "finalShowtimes"
  add column if not exists hebrew_href text;
```

Recommended `localized_content` value:

```json
{
  "he": {
    "title": "שם הסרט",
    "genres": ["דרמה", "קומדיה"],
    "imageSrc": "https://example.com/hebrew-poster.jpg",
    "backdropSrc": "https://example.com/hebrew-backdrop.jpg",
    "trailerKey": "youtube-key"
  }
}
```

Snake-case aliases are also accepted for asset keys (`image_src`, `poster_url`, `backdrop_src`, `backdrop_url`, and `trailer_key`). A JSON string or a native JSON object is accepted.

Every field falls back independently:

| Requested Hebrew field | Fallback |
| --- | --- |
| title | English title |
| genres | built-in Hebrew genre label, then source genre |
| poster | English poster |
| backdrop | English backdrop |
| trailer | English trailer |
| ticket URL | English ticket URL |

This means a row can receive a Hebrew title today and a Hebrew poster later without waiting for a complete translation bundle. Missing columns are also tolerated, allowing the frontend branch to ship before the JSONB column is added.

## Place and theater names

Known cities, chains, and cinematheques are translated at display time in `src/i18n/content.ts`. Their database values are not changed. Unknown names render unchanged with automatic bidirectional isolation, so new venues remain usable before a translation is added.

The map requests Hebrew basemap labels in Hebrew mode and falls back through the source map's default and English name fields. Venue addresses currently fall back to their source-language values.

## Search and sharing

- Search indexes both the visible localized title and the original English title, so either can find a Hebrew-mode result. It also ignores Hebrew niqqud and geresh/gershayim differences.
- Shared movie/showtime URLs remain language-neutral. Recipients see their own saved locale.
- Ticket buttons select the localized URL for the active locale and fall back to English.
- Page titles plus Open Graph and Twitter metadata follow the active language. User-facing failure states are localized while technical provider messages stay in the console.

## Verification checklist

Run:

```sh
npm test
npm run lint
npm run build
```

Browser-check both locales on home, catalog grid/detail, all showtimes, standalone movie, account menu, user preferences, attribution, filters, trailer, and city map. Cover desktop, tablet, 390 px mobile, and the 320 px minimum width. Confirm that refreshing in Hebrew keeps `lang="he"` and `dir="rtl"` before the app paints, then switching back restores `lang="en"` and `dir="ltr"`.
