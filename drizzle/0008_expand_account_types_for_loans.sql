CREATE TABLE `_accounts_0008_backup` AS SELECT * FROM `accounts`;
--> statement-breakpoint
CREATE TABLE `_transactions_0008_backup` AS SELECT * FROM `transactions`;
--> statement-breakpoint
CREATE TABLE `_holdings_0008_backup` AS SELECT * FROM `holdings`;
--> statement-breakpoint
CREATE TABLE `_credit_cards_0008_backup` AS SELECT * FROM `credit_cards`;
--> statement-breakpoint
CREATE TABLE `_card_benefits_0008_backup` AS SELECT * FROM `card_benefits`;
--> statement-breakpoint
DROP TABLE `card_benefits`;
--> statement-breakpoint
DROP TABLE `credit_cards`;
--> statement-breakpoint
DROP TABLE `transactions`;
--> statement-breakpoint
DROP TABLE `holdings`;
--> statement-breakpoint
DROP TABLE `accounts`;
--> statement-breakpoint
CREATE TABLE `accounts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `institution` text NOT NULL,
  `type` text NOT NULL CHECK (`type` IN ('checking', 'savings', 'investment', 'retirement', 'property', 'crypto', 'private_investment', 'credit', 'loan', 'other')),
  `balance` real NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `accounts` (`id`, `name`, `institution`, `type`, `balance`, `created_at`)
SELECT `id`, `name`, `institution`, `type`, `balance`, `created_at` FROM `_accounts_0008_backup`;
--> statement-breakpoint
CREATE TABLE `transactions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` integer NOT NULL,
  `type` text NOT NULL CHECK (`type` IN ('income', 'expense')),
  `category` text NOT NULL,
  `description` text NOT NULL,
  `amount` real NOT NULL,
  `date` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `transactions` (`id`, `account_id`, `type`, `category`, `description`, `amount`, `date`, `created_at`)
SELECT `id`, `account_id`, `type`, `category`, `description`, `amount`, `date`, `created_at` FROM `_transactions_0008_backup`;
--> statement-breakpoint
CREATE INDEX `transactions_account_idx` ON `transactions` (`account_id`);
--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);
--> statement-breakpoint
CREATE TABLE `holdings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` integer NOT NULL,
  `symbol` text NOT NULL,
  `name` text NOT NULL,
  `quantity` real NOT NULL,
  `avg_cost` real NOT NULL,
  `current_price` real NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `holdings` (`id`, `account_id`, `symbol`, `name`, `quantity`, `avg_cost`, `current_price`, `created_at`, `updated_at`)
SELECT `id`, `account_id`, `symbol`, `name`, `quantity`, `avg_cost`, `current_price`, `created_at`, `updated_at` FROM `_holdings_0008_backup`;
--> statement-breakpoint
CREATE INDEX `holdings_account_idx` ON `holdings` (`account_id`);
--> statement-breakpoint
CREATE TABLE `credit_cards` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `account_id` integer,
  `name` text NOT NULL,
  `issuer` text NOT NULL,
  `annual_fee` real NOT NULL,
  `renewal_month` integer,
  `points_balance` real NOT NULL DEFAULT 0,
  `source_url` text,
  `notes` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `credit_cards` (`id`, `account_id`, `name`, `issuer`, `annual_fee`, `renewal_month`, `points_balance`, `source_url`, `notes`, `created_at`)
SELECT `id`, `account_id`, `name`, `issuer`, `annual_fee`, `renewal_month`, `points_balance`, `source_url`, `notes`, `created_at` FROM `_credit_cards_0008_backup`;
--> statement-breakpoint
CREATE TABLE `card_benefits` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `card_id` integer NOT NULL,
  `name` text NOT NULL,
  `expected_value` real NOT NULL,
  `actual_value` real NOT NULL,
  `reset_period` text NOT NULL,
  `notes` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`card_id`) REFERENCES `credit_cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `card_benefits` (`id`, `card_id`, `name`, `expected_value`, `actual_value`, `reset_period`, `notes`, `created_at`, `updated_at`)
SELECT `id`, `card_id`, `name`, `expected_value`, `actual_value`, `reset_period`, `notes`, `created_at`, `updated_at` FROM `_card_benefits_0008_backup`;
--> statement-breakpoint
DROP TABLE `_card_benefits_0008_backup`;
--> statement-breakpoint
DROP TABLE `_credit_cards_0008_backup`;
--> statement-breakpoint
DROP TABLE `_holdings_0008_backup`;
--> statement-breakpoint
DROP TABLE `_transactions_0008_backup`;
--> statement-breakpoint
DROP TABLE `_accounts_0008_backup`;
