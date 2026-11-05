CREATE TABLE "goal_contributions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"goal_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_contributions_type_valid" CHECK ("goal_contributions"."type" in ('deposit', 'withdrawal')),
	CONSTRAINT "goal_contributions_amount_range" CHECK ("goal_contributions"."amount" > 0 and "goal_contributions"."amount" <= 100000000000),
	CONSTRAINT "goal_contributions_note_length" CHECK (char_length("goal_contributions"."note") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_amount" bigint NOT NULL,
	"initial_amount" bigint DEFAULT 0 NOT NULL,
	"deadline" date,
	"color" text NOT NULL,
	"icon" text NOT NULL,
	"is_paused" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_name_length" CHECK (char_length("goals"."name") between 1 and 60),
	CONSTRAINT "goals_description_length" CHECK (char_length("goals"."description") between 1 and 300),
	CONSTRAINT "goals_target_amount_range" CHECK ("goals"."target_amount" > 0 and "goals"."target_amount" <= 100000000000),
	CONSTRAINT "goals_initial_amount_range" CHECK ("goals"."initial_amount" >= 0 and "goals"."initial_amount" <= 100000000000),
	CONSTRAINT "goals_color_valid" CHECK ("goals"."color" in ('#1565c0', '#2e7d32', '#6a1b9a', '#c62828', '#ef6c00', '#00838f', '#ad1457', '#546e7a')),
	CONSTRAINT "goals_icon_valid" CHECK ("goals"."icon" in ('savings', 'flight', 'home', 'directions_car', 'school', 'health_and_safety', 'devices', 'celebration'))
);
--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goal_contributions_goal_id_idx" ON "goal_contributions" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goals_user_id_idx" ON "goals" USING btree ("user_id");