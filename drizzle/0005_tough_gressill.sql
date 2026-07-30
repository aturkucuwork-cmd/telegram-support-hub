CREATE TABLE `telegram_folder_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`folder_id` integer NOT NULL,
	`telegram_peer_id` text NOT NULL,
	`peer_type` text NOT NULL,
	`peer_title` text NOT NULL,
	`peer_username` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_folder_members_folder_peer_unique` ON `telegram_folder_members` (`folder_id`,`telegram_peer_id`);--> statement-breakpoint
CREATE INDEX `telegram_folder_members_peer_idx` ON `telegram_folder_members` (`telegram_peer_id`);--> statement-breakpoint
CREATE TABLE `telegram_folders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_user_id` text NOT NULL,
	`telegram_folder_id` integer NOT NULL,
	`title` text NOT NULL,
	`assigned_to_email` text,
	`mapping_updated_at` text,
	`member_count` integer DEFAULT 0 NOT NULL,
	`last_synced_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_folders_user_folder_unique` ON `telegram_folders` (`telegram_user_id`,`telegram_folder_id`);--> statement-breakpoint
CREATE INDEX `telegram_folders_assignee_idx` ON `telegram_folders` (`assigned_to_email`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `assignment_source` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `assignment_folder_id` integer;--> statement-breakpoint
CREATE INDEX `conversations_assignment_folder_idx` ON `conversations` (`assignment_folder_id`);--> statement-breakpoint
UPDATE `conversations`
SET `assignment_source` = 'manual'
WHERE `assigned_to_email` IS NOT NULL
  AND `assignment_source` IS NULL;
