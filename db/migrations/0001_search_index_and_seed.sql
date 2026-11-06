-- Custom migration: FTS5 search over current published publications, and the one-time category seed.
-- Only published rows are indexed. Revisions are never indexed. Triggers keep the index in step inside the same transaction.
CREATE VIRTUAL TABLE `publications_fts` USING fts5(
  `publication_id` UNINDEXED, `title`, `summary`, `body`,
  tokenize = 'unicode61 remove_diacritics 2', prefix = '2 3'
);
--> statement-breakpoint
CREATE TRIGGER `publications_fts_insert` AFTER INSERT ON `publications` WHEN new.`status` = 'published' BEGIN
  INSERT INTO `publications_fts` (`publication_id`, `title`, `summary`, `body`)
  VALUES (new.`id`, new.`title`, new.`summary`, coalesce(new.`body_markdown`, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `publications_fts_update` AFTER UPDATE ON `publications` BEGIN
  DELETE FROM `publications_fts` WHERE `publication_id` = old.`id`;
  INSERT INTO `publications_fts` (`publication_id`, `title`, `summary`, `body`)
  SELECT new.`id`, new.`title`, new.`summary`, coalesce(new.`body_markdown`, '') WHERE new.`status` = 'published';
END;
--> statement-breakpoint
CREATE TRIGGER `publications_fts_delete` AFTER DELETE ON `publications` BEGIN
  DELETE FROM `publications_fts` WHERE `publication_id` = old.`id`;
END;
--> statement-breakpoint
-- Seed the five starting categories once, and select them for the public homepage in this order.
INSERT OR IGNORE INTO `categories` (`id`, `name`, `normalized_name`, `slug`, `created_at`) VALUES
  ('seed-category-technology', 'Technology', 'technology', 'technology', cast(unixepoch('subsecond') * 1000 as integer)),
  ('seed-category-business', 'Business', 'business', 'business', cast(unixepoch('subsecond') * 1000 as integer)),
  ('seed-category-finance', 'Finance', 'finance', 'finance', cast(unixepoch('subsecond') * 1000 as integer)),
  ('seed-category-sports', 'Sports', 'sports', 'sports', cast(unixepoch('subsecond') * 1000 as integer)),
  ('seed-category-entertainment', 'Entertainment', 'entertainment', 'entertainment', cast(unixepoch('subsecond') * 1000 as integer));
--> statement-breakpoint
INSERT OR IGNORE INTO `homepage_panels` (`category_id`, `position`, `updated_at`, `updated_by_user_id`) VALUES
  ('seed-category-technology', 0, cast(unixepoch('subsecond') * 1000 as integer), NULL),
  ('seed-category-business', 1, cast(unixepoch('subsecond') * 1000 as integer), NULL),
  ('seed-category-finance', 2, cast(unixepoch('subsecond') * 1000 as integer), NULL),
  ('seed-category-sports', 3, cast(unixepoch('subsecond') * 1000 as integer), NULL),
  ('seed-category-entertainment', 4, cast(unixepoch('subsecond') * 1000 as integer), NULL);
