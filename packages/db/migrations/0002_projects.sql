CREATE TABLE `key_projects` (
	`key_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`key_id`, `project_id`),
	FOREIGN KEY (`key_id`) REFERENCES `access_keys`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `key_projects_project_id_idx` ON `key_projects` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
ALTER TABLE `html_documents` ADD `project_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `html_documents_project_id_idx` ON `html_documents` (`project_id`);--> statement-breakpoint
-- Existing data moves to a "default" project: every document, and every key
-- with the role it had (design.md 6.7). Must run before the role column goes.
INSERT INTO `projects` (`slug`, `name`, `created_at`) VALUES ('default', '기본', CAST(strftime('%s', 'now') AS INTEGER) * 1000);--> statement-breakpoint
UPDATE `html_documents` SET `project_id` = (SELECT `id` FROM `projects` WHERE `slug` = 'default');--> statement-breakpoint
INSERT INTO `key_projects` (`key_id`, `project_id`, `role`, `created_at`)
SELECT k.`id`, p.`id`, k.`role`, k.`created_at` FROM `access_keys` k, `projects` p WHERE p.`slug` = 'default';--> statement-breakpoint
ALTER TABLE `access_keys` DROP COLUMN `role`;