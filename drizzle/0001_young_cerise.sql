CREATE TABLE `agent_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`agent_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_agent_idx` ON `agent_sessions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_expires_idx` ON `agent_sessions` (`expires_at`);--> statement-breakpoint
DROP INDEX `conversations_connection_chat_unique`;--> statement-breakpoint
ALTER TABLE `conversations` ADD `topic_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_connection_chat_topic_unique` ON `conversations` (`connection_id`,`telegram_chat_id`,`topic_id`);--> statement-breakpoint
ALTER TABLE `agents` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `password_salt` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `is_active` integer DEFAULT true NOT NULL;