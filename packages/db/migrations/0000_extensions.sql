-- Extensions used across the schema. All three are "trusted", so the migrator role
-- (database owner, not a superuser) can install them.
--   citext      case-insensitive text for emails and logins
--   pg_trgm     fuzzy search on names (duplicate detection, student search)
--   btree_gist  exclusion constraints, e.g. no double-booked rooms or instructors
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
