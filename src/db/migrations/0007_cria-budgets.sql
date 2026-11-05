-- A UNIQUE de categories precisa existir antes da chave estrangeira composta de budgets.
ALTER TABLE "categories" ADD CONSTRAINT "categories_id_user_id_unique" UNIQUE("id","user_id");--> statement-breakpoint
CREATE TABLE "budget_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"budget_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_limits_budget_month_unique" UNIQUE("budget_id","month"),
	CONSTRAINT "budget_limits_month_format" CHECK ("budget_limits"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "budget_limits_amount_range" CHECK ("budget_limits"."amount" > 0 and "budget_limits"."amount" <= 100000000000)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"alert_threshold" smallint DEFAULT 80 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_user_category_unique" UNIQUE("user_id","category_id"),
	CONSTRAINT "budgets_alert_threshold_valid" CHECK ("budgets"."alert_threshold" in (50, 60, 70, 75, 80, 85, 90, 95, 100))
);
--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_fk" FOREIGN KEY ("category_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
