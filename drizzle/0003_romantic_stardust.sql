CREATE TABLE `message_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`conversation_id` integer NOT NULL,
	`telegram_message_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`actor_display_name` text NOT NULL,
	`conversation_title` text NOT NULL,
	`message_text` text NOT NULL,
	`sent_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_logs_conversation_telegram_unique` ON `message_logs` (`conversation_id`,`telegram_message_id`);--> statement-breakpoint
CREATE INDEX `message_logs_sent_at_idx` ON `message_logs` (`sent_at`);--> statement-breakpoint
CREATE INDEX `message_logs_actor_email_idx` ON `message_logs` (`actor_email`);