/**
 * Database seed script for the CSI TCE LeetCode Marathon.
 *
 * Bootstraps the administrator, the contest, both year tracks (enabled), and
 * imports the official First-Year and Second-Year question sets. Re-running is
 * safe and idempotent:
 *   • levels are matched on (track, level_number) - never duplicated;
 *   • imported titles/teasers/URLs are refreshed;
 *   • student progress, points and generated ids are preserved;
 *   • manually configured assessments and scoring settings are never touched.
 *
 * Usage:
 *   npm run db:seed
 */
import bcrypt from "bcryptjs";
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env" });

/**
 * Anything that can run a parameterised query — the production pg
 * client/PoolClient as well as the in-process PGlite test database.
 * Decoupling from `pg` lets the seed logic run against either backend.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

const CONTEST_NAME = "LeetCode Marathon";
const CONTEST_DESCRIPTION =
  "A level-based LeetCode Marathon. Solve each assigned problem on LeetCode, " +
  "report your submission for verification, and climb your year's leaderboard.";

function sslFor(connectionString: string) {
  const requiresSsl =
    /sslmode=(require|verify-ca|verify-full|prefer)/i.test(connectionString) ||
    process.env.PGSSLMODE === "require";
  if (!requiresSsl) return undefined;
  return { rejectUnauthorized: process.env.PGSSL_NO_VERIFY !== "true" };
}

export type MarathonLevel = {
  levelNumber: number;
  title: string;
  teaser: string;
  slug: string;
};

/**
 * Official LeetCode Marathon question sets, in the exact supplied order.
 * Only titles, teasers and URLs are imported here; difficulty, points and
 * conceptual questions remain administrator-configurable.
 */
export const MARATHON: Record<1 | 2, MarathonLevel[]> = {
  1: [
    {
      levelNumber: 1,
      title: "Two Sum",
      teaser:
        "You're given a collection of numbers and a target. Can you identify the right pair efficiently?",
      slug: "two-sum",
    },
    {
      levelNumber: 2,
      title: "Reverse Integer",
      teaser: "Turn a number around digit by digit — but mind the limits of a 32-bit integer.",
      slug: "reverse-integer",
    },
    {
      levelNumber: 3,
      title: "Roman to Integer",
      teaser: "Ancient numerals hide a simple left-to-right rule. Can you decode one?",
      slug: "roman-to-integer",
    },
    {
      levelNumber: 4,
      title: "Add Binary",
      teaser: "Two binary strings, one sum — add them without converting to a big integer.",
      slug: "add-binary",
    },
    {
      levelNumber: 5,
      title: "Remove Element",
      teaser: "Clear every occurrence of a chosen value in place, and report what is left.",
      slug: "remove-element",
    },
    {
      levelNumber: 6,
      title: "Merge Sorted Array",
      teaser: "Two sorted arrays share one destination. Can you merge them in place?",
      slug: "merge-sorted-array",
    },
    {
      levelNumber: 7,
      title: "Pascal's Triangle",
      teaser: "Each entry is built from the two above it. Can you generate the first rows?",
      slug: "pascals-triangle",
    },
    {
      levelNumber: 8,
      title: "Valid Palindrome",
      teaser: "Ignore case and non-alphanumerics — does the sequence read the same both ways?",
      slug: "valid-palindrome",
    },
    {
      levelNumber: 9,
      title: "Sum of Squares of Special Elements",
      teaser: "Find the positions that divide the length evenly, then add the squares of those values.",
      slug: "sum-of-squares-of-special-elements",
    },
    {
      levelNumber: 10,
      title: "Climbing Stairs",
      teaser: "One or two steps at a time — how many distinct ways reach the top?",
      slug: "climbing-stairs",
    },
  ],
  2: [
    {
      levelNumber: 1,
      title: "Two Sum",
      teaser:
        "You're given a collection of numbers and a target. Can you identify the right pair efficiently?",
      slug: "two-sum",
    },
    {
      levelNumber: 2,
      title: "Valid Parentheses",
      teaser: "Three kinds of brackets, strict pairing rules. Is the sequence well formed?",
      slug: "valid-parentheses",
    },
    {
      levelNumber: 3,
      title: "Integer to Roman",
      teaser: "Encode a number using the classical symbol set and its subtractive rules.",
      slug: "integer-to-roman",
    },
    {
      levelNumber: 4,
      title: "Longest Substring Without Repeating Characters",
      teaser: "Find the longest stretch of text with no repeated character.",
      slug: "longest-substring-without-repeating-characters",
    },
    {
      levelNumber: 5,
      title: "First Missing Positive",
      teaser: "Which smallest positive integer is absent from the collection?",
      slug: "first-missing-positive",
    },
    {
      levelNumber: 6,
      title: "Merge Sorted Array",
      teaser: "Two sorted arrays share one destination. Can you merge them in place?",
      slug: "merge-sorted-array",
    },
    {
      levelNumber: 7,
      title: "Pascal's Triangle",
      teaser: "Each entry is built from the two above it. Can you generate the first rows?",
      slug: "pascals-triangle",
    },
    {
      levelNumber: 8,
      title: "Reverse Bits",
      teaser: "Read a fixed-width binary value backwards and return the result.",
      slug: "reverse-bits",
    },
    {
      levelNumber: 9,
      title: "Sum of Squares of Special Elements",
      teaser: "Find the positions that divide the length evenly, then add the squares of those values.",
      slug: "sum-of-squares-of-special-elements",
    },
    {
      levelNumber: 10,
      title: "Climbing Stairs",
      teaser: "One or two steps at a time — how many distinct ways reach the top?",
      slug: "climbing-stairs",
    },
  ],
};

function problemUrl(slug: string): string {
  return `https://leetcode.com/problems/${slug}/`;
}

export async function ensureAdmin(client: Queryable): Promise<string> {
  const existingAny = await client.query<{ id: string; email: string }>(
    "select id, email from admin_users where is_active = true limit 1",
  );
  if (existingAny.rows.length > 0) {
    console.log(`• Administrator account already provisioned (${existingAny.rows[0].email})`);
    return existingAny.rows[0].id;
  }

  const email = (process.env.SEED_ADMIN_EMAIL || "admin@codequest.local").toLowerCase();
  const name = process.env.SEED_ADMIN_NAME || "Contest Administrator";
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe_12345";
  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await client.query<{ id: string }>(
    "select id from admin_users where lower(email) = $1",
    [email],
  );
  if (existing.rows.length > 0) {
    await client.query(
      "update admin_users set name = $2, password_hash = $3, role = 'SUPER_ADMIN', is_active = true where id = $1",
      [existing.rows[0].id, name, passwordHash],
    );
    console.log(`• Updated administrator ${email}`);
    return existing.rows[0].id;
  }
  const inserted = await client.query<{ id: string }>(
    `insert into admin_users (email, name, password_hash, role)
     values ($1, $2, $3, 'SUPER_ADMIN') returning id`,
    [email, name, passwordHash],
  );
  console.log(`✓ Created administrator ${email}`);
  return inserted.rows[0].id;
}

export async function ensureContest(client: Queryable): Promise<string> {
  const existing = await client.query<{ id: string; name: string }>(
    "select id, name from contests where slug = 'codequest'",
  );
  if (existing.rows.length > 0) {
    // Migrate the historical default name to the public event name, but never
    // clobber a name an organiser has chosen themselves.
    if (existing.rows[0].name === "CodeQuest") {
      await client.query("update contests set name = $2 where id = $1", [
        existing.rows[0].id,
        CONTEST_NAME,
      ]);
    }
    console.log(`• Contest 'codequest' already exists`);
    return existing.rows[0].id;
  }
  const inserted = await client.query<{ id: string }>(
    `insert into contests (slug, name, description, timezone, registration_open_at, start_at, end_at)
     values ('codequest', $1, $2, 'Asia/Kolkata', now(), now(), now() + interval '30 days')
     returning id`,
    [CONTEST_NAME, CONTEST_DESCRIPTION],
  );
  console.log(`✓ Created contest '${CONTEST_NAME}'`);
  return inserted.rows[0].id;
}

export async function ensureTracks(client: Queryable, contestId: string): Promise<Record<1 | 2, string>> {
  const result = {} as Record<1 | 2, string>;
  for (const year of [1, 2] as const) {
    // Both years are open by default; organisers may disable either track
    // from the dashboard, but the seed prepares both for the marathon.
    const existing = await client.query<{ id: string }>(
      "select id from contest_tracks where contest_id = $1 and year = $2",
      [contestId, year],
    );
    if (existing.rows.length > 0) {
      await client.query("update contest_tracks set is_active = true where id = $1", [
        existing.rows[0].id,
      ]);
      result[year] = existing.rows[0].id;
      console.log(`• ${year === 1 ? "First" : "Second"} Year track enabled`);
      continue;
    }
    const inserted = await client.query<{ id: string }>(
      `insert into contest_tracks (contest_id, year, name, description, is_active)
       values ($1, $2, $3, $4, true) returning id`,
      [
        contestId,
        year,
        year === 1 ? "First Year" : "Second Year",
        year === 1
          ? "LeetCode Marathon challenges for first-year participants."
          : "LeetCode Marathon challenges for second-year participants.",
      ],
    );
    result[year] = inserted.rows[0].id;
    console.log(`✓ Created ${year === 1 ? "First" : "Second"} Year track (enabled)`);
  }
  return result;
}

/**
 * Imports one marathon level. Content fields (title, teaser, official problem
 * URL/slug) are reconciled on every run; scoring and assessment configuration
 * are only set for brand-new levels and never overwritten afterwards.
 */
export async function importLevel(client: Queryable, trackId: string, level: MarathonLevel): Promise<string> {
  const teaser = level.teaser;
  const url = problemUrl(level.slug);

  const inserted = await client.query<{ id: string }>(
    `insert into levels
       (track_id, level_number, title, description, teaser, difficulty, points, order_index,
        is_active, is_starting, assessment_mode, require_assessment_pass, passing_score, max_attempts)
     values ($1,$2,$3,'',$4,'EASY',10,$2,true,$5,'NONE',false,60,3)
     on conflict (track_id, level_number) do nothing
     returning id`,
    [trackId, level.levelNumber, level.title, teaser, level.levelNumber === 1],
  );

  let levelId = inserted.rows[0]?.id;
  if (levelId) {
    // Nothing else to reconcile for a freshly created level.
  } else {
    const existing = await client.query<{ id: string }>(
      "select id from levels where track_id = $1 and level_number = $2",
      [trackId, level.levelNumber],
    );
    levelId = existing.rows[0]!.id;
    // Refresh imported content only; leave points, difficulty and assessment
    // settings exactly as an administrator may have configured them.
    await client.query(
      `update levels
          set title = $2, teaser = $3, order_index = $4,
              description = case when description = '' then $5 else description end
        where id = $1`,
      [
        levelId,
        level.title,
        teaser,
        level.levelNumber,
        "Official LeetCode Marathon challenge.",
      ],
    );
  }

  // The official problem link is authoritative for the marathon.
  await client.query(
    `insert into leetcode_problems (level_id, title, url, problem_slug, difficulty)
     values ($1, $2, $3, $4, 'EASY')
     on conflict (level_id) do update
       set title = excluded.title, url = excluded.url, problem_slug = excluded.problem_slug`,
    [levelId, level.title, url, level.slug],
  );

  return levelId;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("✗ DATABASE_URL is not set. Configure server/.env first.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString, ssl: sslFor(connectionString), max: 2 });
  const client = await pool.connect();

  try {
    await client.query("begin");
    await ensureAdmin(client);
    const contestId = await ensureContest(client);
    const tracks = await ensureTracks(client, contestId);

    for (const year of [1, 2] as const) {
      for (const level of MARATHON[year]) {
        await importLevel(client, tracks[year], level);
      }
      console.log(
        `✓ Imported ${MARATHON[year].length} ${year === 1 ? "First" : "Second"} Year challenges`,
      );
    }

    await client.query("commit");
    console.log("\n✓ LeetCode Marathon seed complete.");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

import { fileURLToPath } from "node:url";

const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith("seed.ts") ||
    process.argv[1].endsWith("seed.js") ||
    (import.meta.url && fileURLToPath(import.meta.url) === process.argv[1]));

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
