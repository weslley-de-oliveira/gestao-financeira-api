CREATE INDEX "transactions_user_id_account_id_idx" ON "transactions" USING btree ("user_id","account_id");--> statement-breakpoint
CREATE INDEX "transactions_user_id_destination_account_id_idx" ON "transactions" USING btree ("user_id","destination_account_id");--> statement-breakpoint
CREATE INDEX "transactions_user_id_category_id_idx" ON "transactions" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE INDEX "transactions_user_id_amount_id_idx" ON "transactions" USING btree ("user_id","amount","id");