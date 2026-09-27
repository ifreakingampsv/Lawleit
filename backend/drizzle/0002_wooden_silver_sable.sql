CREATE TABLE "case_number_counters" (
	"firm_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_number_counters_firm_id_year_pk" PRIMARY KEY("firm_id","year")
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"client_id" uuid,
	"practice_area" text DEFAULT 'General' NOT NULL,
	"stage" text DEFAULT 'intake' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"open_date" date NOT NULL,
	"court_date" date,
	"statute" text,
	"lead_attorney_id" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"billable_rate" bigint DEFAULT 300000 NOT NULL,
	"trust_balance" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "case_number_counters" ADD CONSTRAINT "case_number_counters_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_client_id_contacts_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_firm_id_idx" ON "cases" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "cases_client_id_idx" ON "cases" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_firm_number_live_key" ON "cases" USING btree ("firm_id","number") WHERE deleted_at is null;