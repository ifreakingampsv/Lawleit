CREATE TABLE "gateway_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"key_id" text NOT NULL,
	"key_secret" text NOT NULL,
	"webhook_secret" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "gateway_accounts" ADD CONSTRAINT "gateway_accounts_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_accounts_firm_id_idx" ON "gateway_accounts" USING btree ("firm_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_accounts_firm_id_live_key" ON "gateway_accounts" USING btree ("firm_id") WHERE deleted_at is null;