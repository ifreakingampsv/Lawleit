import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { ChevronDown } from "lucide-react";
import { Logo } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** Sitemap used for mega-menus (mirrors the source site's nav structure). */
const MENUS: Record<string, { title: string; items: { label: string; to: string; desc?: string }[] }[]> = {
  Products: [
    {
      title: "Core",
      items: [
        { label: "Client Intake & Lead Management", to: "/products/client-intake-lead-management", desc: "Capture and convert more leads" },
        { label: "Case Management", to: "/products/case-management", desc: "Every matter, organized" },
        { label: "Client Communications", to: "/products/client-communications", desc: "Secure portal, texting, email" },
      ],
    },
    {
      title: "Financials",
      items: [
        { label: "Billing & Payments", to: "/products/billing-payments", desc: "Get paid faster with LawleitPay" },
        { label: "Financial Management", to: "/products/financial-management", desc: "Accounting and trust tools" },
      ],
    },
    {
      title: "Intelligence",
      items: [
        { label: "Lawleit AI", to: "/products/legal-ai", desc: "AI-assisted case management" },
        { label: "Reporting", to: "/products/financial-management", desc: "Financial analytics reports" },
      ],
    },
  ],
  "Firm Type": [
    {
      title: "Practice areas",
      items: [
        { label: "Criminal Defense", to: "/products/case-management" },
        { label: "Family Law", to: "/products/case-management" },
        { label: "Immigration Law", to: "/products/client-intake-lead-management" },
        { label: "Bankruptcy Law", to: "/products/case-management" },
        { label: "Personal Injury Law", to: "/products/case-management" },
        { label: "Trust & Estate Law", to: "/products/case-management" },
      ],
    },
    {
      title: "Firm size",
      items: [
        { label: "Solo attorneys", to: "/pricing" },
        { label: "Small firms", to: "/pricing" },
        { label: "Growing firms", to: "/pricing" },
      ],
    },
  ],
  "Partner Network": [
    {
      title: "Partner Network",
      items: [
        { label: "Partnerships", to: "/coming-soon" },
        { label: "Integrations", to: "/coming-soon" },
        { label: "Associations", to: "/coming-soon" },
        { label: "Consultants", to: "/coming-soon" },
        { label: "Lawleit Affiliate Program", to: "/coming-soon" },
      ],
    },
  ],
  "Use Cases": [
    {
      title: "Use Cases",
      items: [
        { label: "Maximize Every Minute", to: "/products/billing-payments" },
        { label: "Gain Financial Freedom", to: "/products/financial-management" },
        { label: "Stay Secure & Compliant", to: "/products/case-management" },
      ],
    },
  ],
  Resources: [
    {
      title: "Resources",
      items: [
        { label: "Blog", to: "/coming-soon" },
        { label: "Guides", to: "/coming-soon" },
        { label: "Case Studies", to: "/coming-soon" },
        { label: "Video Library", to: "/coming-soon" },
        { label: "Webinars", to: "/coming-soon" },
        { label: "Reports", to: "/coming-soon" },
        { label: "AI Resource Center", to: "/products/legal-ai" },
      ],
    },
  ],
};

export default function SiteHeader() {
  const [open, setOpen] = useState<string | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    const onScroll = () => setOpen(null);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const enter = (label: string) => {
    window.clearTimeout(closeTimer.current);
    setOpen(label);
  };
  const leave = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(null), 180);
  };

  return (
    <header data-testid="site-header" className="sticky top-0 z-50">
      {/* utility bar — scrolls away visually under the floating nav card */}
      <div className="bg-[#f4f4f2] px-8">
        <div className="mx-auto flex h-[52px] max-w-[1408px] items-center justify-between text-[13px] font-medium text-neutral-700">
          <nav className="flex items-center gap-6">
            <a href="/" className="font-bold text-foreground">Lawleit</a>
            <a href="/" className="hover:text-foreground">LawleitPay</a>
            <a href="/" className="hover:text-foreground">LawleitPeer</a>
            <a href="/" className="hover:text-foreground">LawleitDocket</a>
          </nav>
          <nav className="flex items-center gap-6">
            <a href="/coming-soon" className="hover:text-foreground">Support</a>
            <Link to="/login" className="hover:text-foreground">Login</Link>
          </nav>
        </div>
      </div>

      {/* floating nav card */}
      <div className="px-6">
        <div className="relative mx-auto max-w-[1392px] rounded-b-2xl bg-white px-6 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.18)]">
          <div className="flex h-20 items-center gap-7">
            <Link to="/" aria-label="Lawleit home" className="shrink-0">
              <Logo />
            </Link>
            <nav className="flex items-center gap-6 text-[15px] font-semibold text-neutral-800" onMouseLeave={leave}>
              {Object.keys(MENUS).map((label) => (
                <div key={label} className="relative" onMouseEnter={() => enter(label)}>
                  <button
                    data-testid={`nav-${label.replace(/\s/g, "-").toLowerCase()}`}
                    className="flex items-center gap-1 py-2 hover:text-lawleit"
                    onClick={() => (open === label ? setOpen(null) : enter(label))}
                  >
                    {label}
                    <ChevronDown className={cn("h-4 w-4 transition-transform", open === label && "rotate-180")} />
                  </button>
                  {open === label && (
                    <div
                      data-testid="mega-menu"
                      onMouseEnter={() => enter(label)}
                      onMouseLeave={leave}
                      className="absolute left-0 -ml-36 top-full z-50 w-[720px] pt-3"
                    >
                      <div className="rounded-2xl border border-neutral-100 bg-white p-7 shadow-2xl">
                        <div className="grid grid-cols-3 gap-7">
                          {MENUS[label].map((group) => (
                            <div key={group.title}>
                              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-neutral-400">{group.title}</p>
                              <ul className="space-y-2.5">
                                {group.items.map((item) => (
                                  <li key={item.label}>
                                    <button
                                      className="text-left text-sm font-semibold text-neutral-800 hover:text-lawleit"
                                      onClick={() => { setOpen(null); navigate(item.to); }}
                                    >
                                      {item.label}
                                    </button>
                                    {item.desc && <p className="text-xs text-neutral-500">{item.desc}</p>}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <NavLink to="/pricing" className={({ isActive }) => (isActive ? "text-lawleit" : "hover:text-lawleit")}>
                Pricing
              </NavLink>
            </nav>
            <div className="ml-auto flex items-center gap-5">
              <Link to="/schedule-demo" className="text-[15px] font-semibold text-lawleit hover:text-lawleit-dark">
                Get a Demo
              </Link>
              <Link
                to="/free-trial"
                data-testid="cta-try-free"
                className="rounded-xl bg-lawleit px-5 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-lawleit-dark"
              >
                Try Lawleit Free
              </Link>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
