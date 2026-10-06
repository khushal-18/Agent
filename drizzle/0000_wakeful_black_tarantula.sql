CREATE TABLE `decision_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_decision_id` text NOT NULL,
	`to_decision_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `decision_edges_project_idx` ON `decision_edges` (`project_id`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stage` text NOT NULL,
	`decision` text NOT NULL,
	`rationale` text NOT NULL,
	`evidence` text NOT NULL,
	`rejected_options` text NOT NULL,
	`assumptions` text NOT NULL,
	`confidence` integer NOT NULL,
	`validation_needed` text NOT NULL,
	`downstream_implications` text NOT NULL,
	`status` text NOT NULL,
	`supersedes_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `decisions_project_stage_idx` ON `decisions` (`project_id`,`stage`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brief_raw` text NOT NULL,
	`constraints` text NOT NULL,
	`current_stage` text NOT NULL,
	`doctrine_version` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stage` text NOT NULL,
	`source_url` text NOT NULL,
	`claim` text NOT NULL,
	`excerpt_summary` text NOT NULL,
	`type` text NOT NULL,
	`confidence` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `revision_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`old_decision_id` text NOT NULL,
	`new_decision_id` text NOT NULL,
	`new_evidence` text NOT NULL,
	`flagged_decision_ids` text NOT NULL,
	`flagged_stages` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `stage_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`run_number` integer NOT NULL,
	`input_snapshot` text NOT NULL,
	`output` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stage_runs_project_stage_idx` ON `stage_runs` (`project_id`,`stage`);