CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"date" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"invoiced" boolean DEFAULT false NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"minutes" integer DEFAULT 0 NOT NULL,
	"rate" bigint DEFAULT 300000 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"invoiced" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_firm_id_idx" ON "expenses" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "expenses_case_id_idx" ON "expenses" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "time_entries_firm_id_idx" ON "time_entries" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "time_entries_case_id_idx" ON "time_entries" USING btree ("case_id");