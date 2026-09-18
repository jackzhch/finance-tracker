CREATE TABLE `balance_snapshots` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `captured_at` integer NOT NULL,
  `total_assets` real NOT NULL,
  `total_investments` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `balance_snapshots_captured_at_idx` ON `balance_snapshots` (`captured_at`);
