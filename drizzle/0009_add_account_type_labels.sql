CREATE TABLE `account_type_labels` (
  `type` text PRIMARY KEY NOT NULL,
  `label` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `account_type_labels` (`type`, `label`) VALUES
  ('checking', '支票账户'),
  ('savings', '储蓄账户'),
  ('investment', '证券投资'),
  ('retirement', '退休账户'),
  ('property', '房产'),
  ('crypto', '数字资产'),
  ('private_investment', '项目投资'),
  ('credit', '信用卡'),
  ('loan', '贷款 / 负债'),
  ('other', '其他');
