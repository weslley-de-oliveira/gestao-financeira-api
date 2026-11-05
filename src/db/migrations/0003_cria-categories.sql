CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"type" text NOT NULL,
	"icon" text NOT NULL,
	"color" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_user_type_name_unique" UNIQUE("user_id","type","name_normalized"),
	CONSTRAINT "categories_name_length" CHECK (char_length("categories"."name") between 1 and 40),
	CONSTRAINT "categories_name_normalized_not_empty" CHECK ("categories"."name_normalized" <> ''),
	CONSTRAINT "categories_type_valid" CHECK ("categories"."type" in ('expense', 'income')),
	CONSTRAINT "categories_color_valid" CHECK ("categories"."color" in ('#1565c0', '#2e7d32', '#6a1b9a', '#c62828', '#ef6c00', '#00838f', '#ad1457', '#546e7a')),
	CONSTRAINT "categories_icon_valid" CHECK ("categories"."icon" in ('restaurant', 'shopping_cart', 'home', 'directions_car', 'directions_bus', 'local_hospital', 'school', 'sports_esports', 'shopping_bag', 'receipt_long', 'bolt', 'wifi', 'pets', 'flight', 'fitness_center', 'checkroom', 'work', 'laptop', 'trending_up', 'card_giftcard', 'payments', 'more_horiz'))
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;