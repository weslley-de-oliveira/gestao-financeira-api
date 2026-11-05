CREATE TABLE "credit_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"last_four_digits" char(4) NOT NULL,
	"credit_limit" bigint NOT NULL,
	"closing_day" smallint NOT NULL,
	"due_day" smallint NOT NULL,
	"payment_account_id" uuid NOT NULL,
	"color" text NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_cards_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "credit_cards_name_length" CHECK (char_length("credit_cards"."name") between 1 and 40),
	CONSTRAINT "credit_cards_brand_valid" CHECK ("credit_cards"."brand" in ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'other')),
	CONSTRAINT "credit_cards_last_four_digits" CHECK ("credit_cards"."last_four_digits" ~ '^[0-9]{4}$'),
	CONSTRAINT "credit_cards_credit_limit_range" CHECK ("credit_cards"."credit_limit" > 0 and "credit_cards"."credit_limit" <= 100000000000),
	CONSTRAINT "credit_cards_days_range" CHECK ("credit_cards"."closing_day" between 1 and 31
        and "credit_cards"."due_day" between 1 and 31),
	CONSTRAINT "credit_cards_days_differ" CHECK ("credit_cards"."closing_day" <> "credit_cards"."due_day"),
	CONSTRAINT "credit_cards_color_valid" CHECK ("credit_cards"."color" in ('#1565c0', '#2e7d32', '#6a1b9a', '#c62828', '#ef6c00', '#00838f', '#ad1457', '#546e7a'))
);
--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_payment_account_fk" FOREIGN KEY ("payment_account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_cards_user_id_idx" ON "credit_cards" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_credit_card_fk" FOREIGN KEY ("credit_card_id","user_id") REFERENCES "public"."credit_cards"("id","user_id") ON DELETE no action ON UPDATE no action;