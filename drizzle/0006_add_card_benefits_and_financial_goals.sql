CREATE TABLE `credit_cards` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `issuer` text NOT NULL,
  `annual_fee` real NOT NULL,
  `renewal_month` integer,
  `notes` text,
  `created_at` integer NOT NULL
);
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
CREATE TABLE `financial_goals` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `title` text NOT NULL,
  `category` text NOT NULL,
  `target_amount` real NOT NULL,
  `current_amount` real NOT NULL,
  `target_date` text,
  `status` text NOT NULL,
  `notes` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);