CREATE TABLE `families` (
	`token` text PRIMARY KEY NOT NULL,
	`morning_confirmed` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
