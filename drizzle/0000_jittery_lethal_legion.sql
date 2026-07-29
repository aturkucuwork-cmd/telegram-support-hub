CREATE TABLE `agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'agent' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_email_unique` ON `agents` (`email`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer,
	`actor_email` text,
	`action` text NOT NULL,
	`detail` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_conversation_idx` ON `audit_logs` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` text NOT NULL,
	`telegram_chat_id` text NOT NULL,
	`type` text DEFAULT 'private' NOT NULL,
	`title` text NOT NULL,
	`username` text,
	`avatar_seed` text,
	`status` text DEFAULT 'open' NOT NULL,
	`assigned_to_email` text,
	`unread_count` integer DEFAULT 0 NOT NULL,
	`last_message` text DEFAULT '' NOT NULL,
	`last_message_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_connection_chat_unique` ON `conversations` (`connection_id`,`telegram_chat_id`);--> statement-breakpoint
CREATE INDEX `conversations_last_message_idx` ON `conversations` (`last_message_at`);--> statement-breakpoint
CREATE INDEX `conversations_assignee_idx` ON `conversations` (`assigned_to_email`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`telegram_message_id` text NOT NULL,
	`update_id` text,
	`direction` text NOT NULL,
	`sender_id` text,
	`sender_name` text,
	`text` text DEFAULT '' NOT NULL,
	`content_type` text DEFAULT 'text' NOT NULL,
	`file_id` text,
	`file_name` text,
	`mime_type` text,
	`is_edited` integer DEFAULT false NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`sent_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_conversation_telegram_unique` ON `messages` (`conversation_id`,`telegram_message_id`);--> statement-breakpoint
CREATE INDEX `messages_conversation_sent_idx` ON `messages` (`conversation_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `telegram_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_user_id` text,
	`display_name` text DEFAULT 'Telegram hesabı' NOT NULL,
	`username` text,
	`rights_json` text DEFAULT '{}' NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_updates` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
