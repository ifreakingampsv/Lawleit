import { useState } from "react";
import { api, apiMode } from "@/lib/data";
import type { User } from "@/lib/data";
import { useAsync } from "@/lib/hooks";
import { formatINR0 } from "@/lib/money";
import { resetDemoData } from "../demoReset";
import { Card, CardTitle, Field, inputCls, Avatar } from "../ui";

/** Shown when the invite submit fails without a server answer (network, CORS, cold start). */
const NETWORK_ERROR = "Couldn't reach the server — it may be waking up. Try again in a moment.";

/** Server messages ("Email already registered", the owner-only 403) pass through verbatim;
 * a dropped fetch rejects with TypeError and gets the retry hint instead. Same rule as
 * the auth pages, widened to accept the mock adapter's plain Error messages. */
function inviteErrorMessage(e: unknown): string {
  if (e instanceof TypeError) return NETWORK_ERROR;
  return e instanceof Error ? e.message : NETWORK_ERROR;
}

export default function SettingsPage() {
  const { data: session, refetch: refetchSession } = useAsync(() => api.getSession(), []);
  const { data: users, refetch: refetchUsers } = useAsync(() => api.listUsers(), []);
  const [firm, setFirm] = useState(session?.firm);
  const [saved, setSaved] = useState(false);

  if (!firm && session?.firm) setFirm(session.firm);
  if (!firm) return null;

  const saveFirm = async () => {
    await api.updateFirm(firm);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
    refetchSession();
  };

  return (
    <div data-testid="settings-page" className="mx-auto max-w-[900px] px-8 pb-12">
      <div className="pb-2 pt-6">
        <h1 className="text-[22px] font-bold tracking-tight text-neutral-900">Settings</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">Firm profile, users, and plan</p>
      </div>

      <div className="space-y-5">
        <Card className="p-6">
          <CardTitle>Firm profile</CardTitle>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Firm name"><input data-testid="firm-name" className={inputCls} value={firm.name} onChange={(e) => setFirm({ ...firm, name: e.target.value })} /></Field>
            <Field label="Phone"><input className={inputCls} value={firm.phone} onChange={(e) => setFirm({ ...firm, phone: e.target.value })} /></Field>
            <Field label="Email"><input className={inputCls} value={firm.email} onChange={(e) => setFirm({ ...firm, email: e.target.value })} /></Field>
            <Field label="Address"><input className={inputCls} value={firm.address} onChange={(e) => setFirm({ ...firm, address: e.target.value })} /></Field>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button data-testid="firm-save" onClick={saveFirm} className="rounded-full bg-lawleit px-6 py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark">Save changes</button>
            {saved && <span data-testid="firm-saved" className="text-[13px] font-semibold text-emerald-600">Saved ✓</span>}
          </div>
        </Card>

        <Card className="p-6">
          <CardTitle>Firm users ({(users ?? []).length})</CardTitle>
          <table className="w-full text-left text-[13.5px]">
            <thead><tr className="border-b border-neutral-200 text-[11.5px] uppercase text-neutral-500">
              <th className="py-2">User</th><th className="py-2">Role</th><th className="py-2 text-right">Hourly rate</th>
            </tr></thead>
            <tbody className="divide-y divide-neutral-100">
              {(users ?? []).map((u) => (
                <tr key={u.id}>
                  <td className="py-3">
                    <span className="flex items-center gap-3">
                      <Avatar name={u.name} color={u.avatarColor} size="sm" />
                      <span>
                        <span className="font-semibold">{u.name}</span>
                        <span className="block text-[12px] text-neutral-500">{u.email}</span>
                      </span>
                    </span>
                  </td>
                  <td className="py-3 capitalize">{u.role}</td>
                  <td className="py-3 text-right font-semibold">{formatINR0(u.hourlyRate)}/hr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        {session?.user.role === "owner" && <InviteUserCard onInvited={() => void refetchUsers()} />}
        {session?.user.role === "owner" && <GatewayCard />}

        <Card className="p-6">
          <CardTitle>Plan &amp; billing</CardTitle>
          <div className="flex items-center justify-between rounded-xl border border-neutral-200 p-5">
            <div>
              <p className="text-[15px] font-bold capitalize text-neutral-900">Lawleit {firm.plan} — trial</p>
              <p className="text-[13px] text-neutral-500">Trial ends {new Date(`${firm.trialEndsAt}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
            </div>
            <button className="rounded-full bg-lawleit px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-lawleit-dark">Upgrade plan</button>
          </div>
          {apiMode === "mock" && (
            <div className="mt-4 rounded-xl border border-dashed border-neutral-300 p-5">
              <p className="text-[13.5px] font-bold text-neutral-800">Connect your backend</p>
              <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">
                This build ships with a mock adapter (localStorage). To go live, implement
                <code className="mx-1 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px]">src/lib/data/httpAdapter.ts</code>
                against <code className="mx-1 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px]">docs/API_CONTRACT.md</code>
                and flip the adapter in <code className="mx-1 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px]">src/lib/data/index.ts</code>.
              </p>
            </div>
          )}
        </Card>

        {apiMode === "mock" && <DemoDataCard />}
      </div>
    </div>
  );
}

/** Demo Version housekeeping (ADR 0001): restore the pristine seeded firm. */
function DemoDataCard() {
  const [confirming, setConfirming] = useState(false);
  return (
    <Card className="p-6" testid="demo-data-card">
      <CardTitle>Demo data</CardTitle>
      <div>
        <p className="text-[13px] leading-relaxed text-neutral-500">
          You are exploring the Demo Version. Everything you change is stored only in
          this browser; resetting brings back the seeded Demo Firm exactly as it shipped.
        </p>
        {confirming ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-[13px] font-semibold text-red-700">Wipe all local edits and restore the seeded firm?</p>
            <div className="ml-auto flex items-center gap-2">
              <button data-testid="reset-demo-confirm" onClick={() => void resetDemoData()} className="rounded-full bg-red-600 px-5 py-2 text-[13px] font-bold text-white hover:bg-red-700">Reset now</button>
              <button data-testid="reset-demo-cancel" onClick={() => setConfirming(false)} className="rounded-full border border-neutral-300 bg-white px-5 py-2 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-50">Cancel</button>
            </div>
          </div>
        ) : (
          <button data-testid="reset-demo" onClick={() => setConfirming(true)} className="mt-4 rounded-full border border-neutral-300 px-5 py-2 text-[13px] font-bold text-neutral-800 hover:bg-neutral-50">
            Reset demo data
          </button>
        )}
      </div>
    </Card>
  );
}

/** Owner-only invite form (POST /users): the new teammate shows up in the
 *  table above once the backend accepts and mails their set-password link. */
function InviteUserCard({ onInvited }: { onInvited: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<User["role"]>("attorney");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInvited(null);
    try {
      await api.createUser({ name, email, role });
      setInvited(email.trim());
      setName("");
      setEmail("");
      setRole("attorney");
      onInvited();
    } catch (err) {
      setError(inviteErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6" testid="invite-card">
      <CardTitle>Invite user</CardTitle>
      <p className="-mt-2 pb-3 text-[13px] text-neutral-500">
        The invited person will get a link to set their password.
      </p>
      <form onSubmit={submit} data-testid="invite-form">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Name">
            <input data-testid="invite-name" required className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email">
            <input data-testid="invite-email" type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Role">
            <select data-testid="invite-role" className={inputCls} value={role} onChange={(e) => setRole(e.target.value as User["role"])}>
              <option value="attorney">Attorney</option>
              <option value="paralegal">Paralegal</option>
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            data-testid="invite-submit"
            type="submit"
            disabled={busy}
            className="rounded-full bg-lawleit px-6 py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send invite"}
          </button>
          {invited && (
            <span data-testid="invite-sent" className="text-[13px] font-semibold text-emerald-600">
              Invite sent — {invited} will get a link to set their password.
            </span>
          )}
          {error && (
            <span role="alert" data-testid="invite-error" className="text-[13px] font-semibold text-red-600">
              {error}
            </span>
          )}
        </div>
      </form>
    </Card>
  );
}

/**
 * Owner-only payments gateway card (V2 slice 1, ADR-0006): connect or replace
 * the firm's OWN Razorpay account by pasting its API keys. Secrets are
 * write-only — the status shape never carries them back, so the form starts
 * empty on every visit and only the key id is shown as a hint. Server
 * messages pass through verbatim (the invite rule): the 403 owner gate, the
 * 400 field message, and the operator's 503 "set GATEWAY_ENCRYPTION_KEY".
 */
function GatewayCard() {
  const { data: account, refetch } = useAsync(() => api.getGatewayAccount(), []);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.connectGatewayAccount({ keyId, keySecret, webhookSecret });
      setSaved(true);
      setKeySecret("");
      setWebhookSecret("");
      refetch();
    } catch (err) {
      setError(inviteErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.disconnectGatewayAccount();
      refetch();
    } catch (err) {
      setError(inviteErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-6" testid="gateway-card">
      <CardTitle>Payments gateway</CardTitle>
      <p className="-mt-2 pb-3 text-[13px] leading-relaxed text-neutral-500">
        Connect the firm's own Razorpay account to collect invoice payments by UPI, card,
        or netbanking — money settles directly into the firm's bank account. Every client
        firm needs its own Razorpay account (
        <a
          href="https://razorpay.com/signup/"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-lawleit hover:underline"
        >
          signup &amp; KYC checklist
        </a>
        ): business PAN, a bank account in the business name, business proof, and live
        Privacy/Terms/Refund/Contact pages on your website.
      </p>

      {account?.connected ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" data-testid="gateway-status">
          <p className="text-[13.5px] font-bold capitalize text-emerald-800">
            {account.provider} connected — {account.keyId}
          </p>
          <p className="mt-0.5 text-[12.5px] text-emerald-700">
            Connected {new Date(account.connectedAt!).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
            Configure the webhook in your Razorpay dashboard to{" "}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[11.5px]">
              {"{APP_BASE_URL}"}/api/v1/webhooks/razorpay/{"{firm id}"}
            </code>{" "}
            with the same webhook secret.
          </p>
          <button
            data-testid="gateway-disconnect"
            onClick={() => void disconnect()}
            disabled={busy}
            className="mt-3 rounded-full border border-red-300 px-4 py-1.5 text-[12.5px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <form onSubmit={submit} data-testid="gateway-form">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Key id">
              <input data-testid="gateway-key-id" required className={inputCls} value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_test_…" />
            </Field>
            <Field label="Key secret">
              <input data-testid="gateway-key-secret" required type="password" className={inputCls} value={keySecret} onChange={(e) => setKeySecret(e.target.value)} />
            </Field>
            <Field label="Webhook secret">
              <input data-testid="gateway-webhook-secret" required type="password" className={inputCls} value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
            </Field>
          </div>
          <p className="mt-2 text-[12px] text-neutral-500">
            Stored AES-256-GCM encrypted at rest, never shown again, never logged.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              data-testid="gateway-submit"
              type="submit"
              disabled={busy}
              className="rounded-full bg-lawleit px-6 py-2.5 text-[14px] font-bold text-white hover:bg-lawleit-dark disabled:opacity-60"
            >
              {busy ? "Saving…" : "Connect gateway"}
            </button>
            {saved && (
              <span data-testid="gateway-saved" className="text-[13px] font-semibold text-emerald-600">
                Gateway connected ✓
              </span>
            )}
            {error && (
              <span role="alert" data-testid="gateway-error" className="text-[13px] font-semibold text-red-600">
                {error}
              </span>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
