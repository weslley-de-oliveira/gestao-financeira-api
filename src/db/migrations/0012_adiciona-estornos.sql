ALTER TABLE "transactions" DROP CONSTRAINT "transactions_type_valid";--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_shape";--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "refunded_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_id_user_id_unique" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_refunded_transaction_fk" FOREIGN KEY ("refunded_transaction_id","user_id") REFERENCES "public"."transactions"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_refunded_transaction_id_idx" ON "transactions" USING btree ("refunded_transaction_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_refund_link" CHECK (("transactions"."type" = 'refund') = ("transactions"."refunded_transaction_id" is not null));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_type_valid" CHECK ("transactions"."type" in ('expense', 'income', 'transfer', 'invoice-payment', 'refund'));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_shape" CHECK ((
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
      ) or (
        "transactions"."type" = 'refund'
        and (("transactions"."account_id" is null) <> ("transactions"."credit_card_id" is null))
        and "transactions"."category_id" is null
        and "transactions"."destination_account_id" is null
        and "transactions"."invoice_month" is null
        and "transactions"."status" = 'completed'
      ));