CREATE TABLE `agent_prompt_revisions` (
	`key` text NOT NULL,
	`revision` integer NOT NULL,
	`body` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`created_by_user_id` text,
	PRIMARY KEY(`key`, `revision`),
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
