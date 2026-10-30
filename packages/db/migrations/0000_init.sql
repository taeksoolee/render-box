CREATE TABLE `access_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_keys_key_hash_unique` ON `access_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `html_blobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`size` integer NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `access_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `html_chunks` (
	`blob_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`data` blob NOT NULL,
	PRIMARY KEY(`blob_id`, `seq`),
	FOREIGN KEY (`blob_id`) REFERENCES `html_blobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `html_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_key` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`links` text DEFAULT '[]' NOT NULL,
	`blob_id` integer NOT NULL,
	`html_size` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` integer NOT NULL,
	`updated_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`blob_id`) REFERENCES `html_blobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `access_keys`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `access_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `html_documents_document_key_unique` ON `html_documents` (`document_key`);--> statement-breakpoint
CREATE INDEX `html_documents_updated_at_idx` ON `html_documents` (`updated_at`);--> statement-breakpoint
CREATE INDEX `html_documents_blob_id_idx` ON `html_documents` (`blob_id`);--> statement-breakpoint
CREATE TABLE `login_failures` (
	`ip` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_failures_ip_at_idx` ON `login_failures` (`ip`,`at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`key_id` integer NOT NULL,
	`host` text NOT NULL,
	`family_id` text NOT NULL,
	`csrf_token` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`key_id`) REFERENCES `access_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_key_id_idx` ON `sessions` (`key_id`);--> statement-breakpoint
CREATE INDEX `sessions_family_id_idx` ON `sessions` (`family_id`);