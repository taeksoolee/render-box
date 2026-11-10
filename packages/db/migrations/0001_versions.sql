CREATE TABLE `html_document_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`blob_id` integer NOT NULL,
	`html_size` integer NOT NULL,
	`restored_from` integer,
	`created_by` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `html_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blob_id`) REFERENCES `html_blobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `access_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `html_document_versions_document_seq_unique` ON `html_document_versions` (`document_id`,`seq`);--> statement-breakpoint
CREATE INDEX `html_document_versions_blob_id_idx` ON `html_document_versions` (`blob_id`);--> statement-breakpoint
-- Existing documents start with their current HTML as version 1 (design.md 6.6).
INSERT INTO `html_document_versions` (`document_id`, `seq`, `blob_id`, `html_size`, `created_by`, `created_at`)
SELECT d.`id`, 1, d.`blob_id`, d.`html_size`, b.`created_by`, b.`created_at`
FROM `html_documents` d JOIN `html_blobs` b ON b.`id` = d.`blob_id`;
