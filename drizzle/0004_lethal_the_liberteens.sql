CREATE TABLE `telegram_user_listeners` (
	`id` text PRIMARY KEY NOT NULL,
	`telegram_user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`username` text,
	`is_enabled` integer DEFAULT true NOT NULL,
	`last_heartbeat_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
