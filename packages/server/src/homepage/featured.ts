import type { ApplicationDatabase } from "../db/client.js";
import {
  homepageFeaturedWeeklyLineups,
  homepageMovieHighlights,
  homepagePromotions,
} from "../db/schema.js";
import { homepageFeaturedResponseSchema } from "@kartiseret/contracts/homepage-featured";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import {
  getCinemaDayDate,
  SHOWTIME_TIME_ZONE,
} from "@kartiseret/contracts/showtime-day";

export function homepageWeekStart(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  const daysSinceThursday = (parsed.getUTCDay() + 3) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - daysSinceThursday);
  return parsed.toISOString().slice(0, 10);
}

function serializeHighlight(row: typeof homepageMovieHighlights.$inferSelect) {
  return {
    tmdbId: String(row.tmdbId),
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    priority: row.priority,
    label: row.label,
    enabled: row.enabled,
  };
}

function serializePromotion(row: typeof homepagePromotions.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    priority: row.priority,
    ctaLabel: row.ctaLabel,
    ctaHref: row.ctaHref,
    enabled: row.enabled,
  };
}

export class HomepageFeaturedService {
  constructor(private readonly db: ApplicationDatabase) {}

  async readPublic(instant = new Date()) {
    const today = getCinemaDayDate(instant, SHOWTIME_TIME_ZONE);
    const weekStart = homepageWeekStart(today);
    const [lineupRows, highlightRows, promotionRows] = await Promise.all([
      this.db
        .select()
        .from(homepageFeaturedWeeklyLineups)
        .where(lte(homepageFeaturedWeeklyLineups.weekStart, weekStart))
        .orderBy(desc(homepageFeaturedWeeklyLineups.weekStart))
        .limit(1),
      this.db
        .select()
        .from(homepageMovieHighlights)
        .where(
          and(
            eq(homepageMovieHighlights.enabled, true),
            lte(homepageMovieHighlights.startsOn, today),
            gte(homepageMovieHighlights.endsOn, today),
          ),
        )
        .orderBy(
          desc(homepageMovieHighlights.priority),
          asc(homepageMovieHighlights.createdAt),
        ),
      this.db
        .select()
        .from(homepagePromotions)
        .where(
          and(
            eq(homepagePromotions.enabled, true),
            lte(homepagePromotions.startsOn, today),
            gte(homepagePromotions.endsOn, today),
          ),
        )
        .orderBy(
          desc(homepagePromotions.priority),
          asc(homepagePromotions.createdAt),
        ),
    ]);
    const lineup = lineupRows[0]
      ? {
          weekStart: lineupRows[0].weekStart,
          nowPlayingIds: lineupRows[0].nowPlayingIds.map(String),
          comingSoonIds: lineupRows[0].comingSoonIds.map(String),
        }
      : null;

    return homepageFeaturedResponseSchema.parse({
      data: {
        lineup,
        highlights: highlightRows.map(serializeHighlight),
        promotions: promotionRows.map(serializePromotion),
      },
      error: null,
    });
  }
}
