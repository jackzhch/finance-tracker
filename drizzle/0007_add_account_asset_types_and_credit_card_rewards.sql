ALTER TABLE `credit_cards` ADD COLUMN `account_id` integer REFERENCES `accounts`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `credit_cards` ADD COLUMN `points_balance` real NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `credit_cards` ADD COLUMN `source_url` text;
