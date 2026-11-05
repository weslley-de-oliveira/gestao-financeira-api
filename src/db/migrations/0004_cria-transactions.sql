-- As UNIQUE de accounts e categories precisam existir antes das chaves estrangeiras compostas.
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_id_user_id_unique" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_id_user_id_type_unique" UNIQUE("id","user_id","type");--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"amount" bigint NOT NULL,
	"date" date NOT NULL,
	"account_id" uuid,
	"credit_card_id" uuid,
	"invoice_month" char(7),
	"destination_account_id" uuid,
	"category_id" uuid,
	"status" text DEFAULT 'completed' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_type_valid" CHECK ("transactions"."type" in ('expense', 'income', 'transfer', 'invoice-payment')),
	CONSTRAINT "transactions_status_valid" CHECK ("transactions"."status" in ('completed', 'pending')),
	CONSTRAINT "transactions_amount_range" CHECK ("transactions"."amount" > 0 and "transactions"."amount" <= 100000000000),
	CONSTRAINT "transactions_description_length" CHECK (char_length("transactions"."description") between 1 and 80),
	CONSTRAINT "transactions_notes_length" CHECK (char_length("transactions"."notes") between 1 and 500),
	CONSTRAINT "transactions_invoice_month_format" CHECK ("transactions"."invoice_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "transactions_shape" CHECK ((
        "transactions"."type" in ('expense', 'income')
        and "transactions"."category_id" is not null
        and "transactions"."destination_account_id" is null
        and "transactions"."invoice_month" is null
        and (
          ("transactions"."account_id" is not null and "transactions"."credit_card_id" is null)
          or (
            "transactions"."type" = 'expense'
            and "transactions"."account_id" is null
            and "transactions"."credit_card_id" is not null
            and "transactions"."status" = 'completed'
          )
        )
      ) or (
        "transactions"."type" = 'transfer'
        and "transactions"."account_id" is not null
        and "transactions"."destination_account_id" is not null
        and "transactions"."account_id" <> "transactions"."destination_account_id"
        and "transactions"."category_id" is null
        and "transactions"."credit_card_id" is null
        and "transactions"."invoice_month" is null
      ) or (
        "transactions"."type" = 'invoice-payment'
        and "transactions"."account_id" is not null
        and "transactions"."credit_card_id" is not null
        and "transactions"."invoice_month" is not null
        and "transactions"."category_id" is null
        and "transactions"."destination_account_id" is null
        and "transactions"."status" = 'completed'
      ))
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_fk" FOREIGN KEY ("account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_destination_account_fk" FOREIGN KEY ("destination_account_id","user_id") REFERENCES "public"."accounts"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_fk" FOREIGN KEY ("category_id","user_id","type") REFERENCES "public"."categories"("id","user_id","type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_user_id_date_idx" ON "transactions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "transactions_credit_card_id_date_idx" ON "transactions" USING btree ("credit_card_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_invoice_payment_unique" ON "transactions" USING btree ("credit_card_id","invoice_month") WHERE "transactions"."type" = 'invoice-payment';--> statement-breakpoint
