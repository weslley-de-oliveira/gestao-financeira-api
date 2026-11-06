ALTER TABLE "transactions" ADD COLUMN "installment_group_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "installment_number" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "installment_count" integer;--> statement-breakpoint
CREATE INDEX "transactions_user_id_installment_group_id_idx" ON "transactions" USING btree ("user_id","installment_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_installment_unique" ON "transactions" USING btree ("installment_group_id","installment_number");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installment_shape" CHECK ((
        "transactions"."installment_group_id" is null
        and "transactions"."installment_number" is null
        and "transactions"."installment_count" is null
      ) or (
        "transactions"."installment_group_id" is not null
        and "transactions"."installment_number" is not null
        and "transactions"."installment_count" is not null
        and "transactions"."installment_count" between 2 and 24
        and "transactions"."installment_number" between 1 and "transactions"."installment_count"
        and "transactions"."type" = 'expense'
        and "transactions"."credit_card_id" is not null
        and "transactions"."account_id" is null
      ));