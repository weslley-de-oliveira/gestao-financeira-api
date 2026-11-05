CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"institution" text,
	"initial_balance" bigint DEFAULT 0 NOT NULL,
	"color" text NOT NULL,
	"icon" text NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_name_length" CHECK (char_length("accounts"."name") between 1 and 60),
	CONSTRAINT "accounts_institution_length" CHECK (char_length("accounts"."institution") between 1 and 60),
	CONSTRAINT "accounts_type_valid" CHECK ("accounts"."type" in ('checking', 'savings', 'cash', 'investment', 'other')),
	CONSTRAINT "accounts_color_valid" CHECK ("accounts"."color" in ('#1565c0', '#2e7d32', '#6a1b9a', '#c62828', '#ef6c00', '#00838f', '#ad1457', '#546e7a')),
	CONSTRAINT "accounts_icon_valid" CHECK ("accounts"."icon" in ('account_balance', 'account_balance_wallet', 'savings', 'payments', 'trending_up', 'credit_card', 'store', 'home')),
	CONSTRAINT "accounts_initial_balance_range" CHECK (abs("accounts"."initial_balance") <= 100000000000)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");