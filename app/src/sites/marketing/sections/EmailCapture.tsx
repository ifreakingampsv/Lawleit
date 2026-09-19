import { useState } from "react";
import { useNavigate } from "react-router";

/** Email capture used in hero / final CTA / product pages. */
export default function EmailCapture({
  align = "left",
  size = "md",
}: {
  align?: "left" | "center";
  size?: "md" | "sm";
}) {
  const [email, setEmail] = useState("");
  const navigate = useNavigate();
  const go = () => {
    navigate("/free-trial", { state: { email } });
  };
  const h = size === "sm" ? "h-[52px]" : "h-14";
  return (
    <div className={align === "center" ? "flex flex-col items-center" : ""}>
      <div className={`flex ${align === "center" ? "justify-center" : ""} gap-3`}>
        <input
          data-testid="email-capture-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className={`${h} w-[320px] rounded-xl border border-neutral-200 bg-white px-5 text-[15px] text-neutral-900 outline-none placeholder:text-neutral-500 focus:border-lawleit`}
        />
        <button
          data-testid="email-capture-submit"
          onClick={go}
          className={`${h} rounded-xl bg-lawleit px-7 text-[15px] font-bold text-white transition hover:bg-lawleit-dark`}
        >
          Get Started
        </button>
      </div>
      {align === "center" ? (
        <p className="mt-2.5 text-[13px] text-neutral-600">No credit card required.</p>
      ) : (
        <p className="mt-2.5 text-center text-[13px] text-neutral-600" style={{ width: 320 }}>
          No credit card required.
        </p>
      )}
    </div>
  );
}
