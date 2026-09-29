CREATE TABLE "trust_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"client_id" uuid,
	"case_id" uuid,
	"date" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"seq" bigserial NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trust_transactions" ADD CONSTRAINT "trust_transactions_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_transactions" ADD CONSTRAINT "trust_transactions_client_id_contacts_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_transactions" ADD CONSTRAINT "trust_transactions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trust_transactions_firm_id_idx" ON "trust_transactions" USING btree ("firm_id");--> statement-breakpoint
CREATE INDEX "trust_transactions_client_id_idx" ON "trust_transactions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "trust_transactions_case_id_idx" ON "trust_transactions" USING btree ("case_id");