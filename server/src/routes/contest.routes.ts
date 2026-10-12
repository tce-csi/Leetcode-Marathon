import { Router } from "express";
import { requireAdmin } from "@/lib/auth/guard";
import { errors } from "@/lib/errors";
import { asyncHandler, ok } from "@/lib/http";
import { getContestBundle, requireActiveContest } from "@/lib/services/contest";
import { getLeaderboard } from "@/lib/services/leaderboard";
import type { Year } from "@/lib/types";

export const contestRoutes = Router();

contestRoutes.get(
  "/contest",
  asyncHandler(async (_req, res) => {
    const bundle = await getContestBundle();
    if (!bundle) {
      ok(res, { contest: null, tracks: [], status: null });
      return;
    }
    ok(res, {
      contest: bundle.contest,
      tracks: bundle.tracks,
      status: bundle.status,
    });
  }),
);

contestRoutes.get(
  "/leaderboard",
  asyncHandler(async (req, res) => {
    await requireAdmin(req);
    const yearParam = Number(req.query.year);
    if (yearParam !== 1 && yearParam !== 2) {
      throw errors.badRequest("Query parameter 'year' must be 1 or 2.");
    }
    const contest = await requireActiveContest();
    if (!contest.leaderboard_visible) {
      throw errors.forbidden("The leaderboard is currently hidden.");
    }
    const entries = await getLeaderboard(contest, yearParam as Year, {});
    ok(res, { entries, year: yearParam });
  }),
);