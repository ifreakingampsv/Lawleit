import { Link } from "react-router";
import { FamilyWordmark } from "@/lib/brand";

const COLS: { title: string; links: { label: string; to: string }[] }[] = [
  {
    title: "Products",
    links: [
      { label: "Client Intake & Lead Management", to: "/products/client-intake-lead-management" },
      { label: "Case Management", to: "/products/case-management" },
      { label: "Client Communications", to: "/products/client-communications" },
      { label: "Billing & Payments", to: "/products/billing-payments" },
      { label: "Lawleit AI", to: "/products/legal-ai" },
      { label: "Financial Management", to: "/products/financial-management" },
      { label: "View all features", to: "/pricing" },
    ],
  },
  {
    title: "Pricing",
    links: [
      { label: "View plans", to: "/pricing" },
      { label: "Compare Lawleit", to: "/pricing" },
    ],
  },
  {
    title: "Firm Type",
    links: [
      { label: "Criminal Defense", to: "/products/case-management" },
      { label: "Family Law", to: "/products/case-management" },
      { label: "Immigration Law", to: "/products/client-intake-lead-management" },
      { label: "Bankruptcy Law", to: "/products/case-management" },
      { label: "Personal Injury Law", to: "/products/case-management" },
      { label: "Trust & Estate Law", to: "/products/case-management" },
      { label: "View all practice areas", to: "/products/case-management" },
    ],
  },
  {
    title: "Partner Network",
    links: [
      { label: "Partnerships", to: "/coming-soon" },
      { label: "Integrations", to: "/coming-soon" },
      { label: "Associations", to: "/coming-soon" },
      { label: "Consultants", to: "/coming-soon" },
      { label: "Lawleit Affiliate Program", to: "/coming-soon" },
    ],
  },
];

const COLS2: { title: string; links: { label: string; to: string }[] }[] = [
  {
    title: "Resources",
    links: [
      { label: "Blog", to: "/coming-soon" },
      { label: "Guides", to: "/coming-soon" },
      { label: "Case Studies", to: "/coming-soon" },
      { label: "Video Library", to: "/coming-soon" },
      { label: "Interactive Tools", to: "/coming-soon" },
      { label: "Webinars", to: "/coming-soon" },
      { label: "Reports", to: "/coming-soon" },
      { label: "AI Resource Center", to: "/products/legal-ai" },
    ],
  },
  {
    title: "Use Cases",
    links: [
      { label: "Maximize Every Minute", to: "/products/billing-payments" },
      { label: "Gain Financial Freedom", to: "/products/financial-management" },
      { label: "Stay Secure & Compliant", to: "/products/case-management" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Help Articles", to: "/coming-soon" },
      { label: "Training", to: "/coming-soon" },
      { label: "Contact Support", to: "/coming-soon" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", to: "/coming-soon" },
      { label: "Why Lawleit", to: "/coming-soon" },
      { label: "In the news", to: "/coming-soon" },
      { label: "Careers", to: "/coming-soon" },
      { label: "Reviews", to: "/coming-soon" },
      { label: "Refer a Colleague", to: "/coming-soon" },
      { label: "Security", to: "/coming-soon" },
    ],
  },
];

function SocialIcon({ kind }: { kind: "linkedin" | "youtube" | "x" | "facebook" }) {
  const paths: Record<string, string> = {
    linkedin: "M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.2 8h4.6v14.8H.2V8zm7.6 0h4.4v2h.06c.62-1.16 2.12-2.4 4.36-2.4 4.66 0 5.52 3.06 5.52 7.04v8.16h-4.6v-7.24c0-1.72-.04-3.94-2.4-3.94-2.4 0-2.76 1.88-2.76 3.82v7.36H7.8V8z",
    youtube: "M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4L15.8 12l-6.2 3.6z",
    x: "M18.9 1.2h3.7l-8.1 9.3L24 22.8h-7.5l-5.9-7.7-6.7 7.7H.2l8.7-9.9L0 1.2h7.7l5.3 7 6-7zm-1.3 19.4h2L6.6 3.3h-2.2l13.2 17.3z",
    facebook: "M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.6-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z",
  };
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white/90 hover:fill-white" aria-label={kind}>
      <path d={paths[kind]} />
    </svg>
  );
}

export default function SiteFooter() {
  return (
    <footer className="lawleit-footer-bg mt-auto rounded-t-3xl text-white">
      <div className="mx-auto max-w-[1280px] px-8 pb-10 pt-14">
        {/* brand family row */}
        <div className="flex flex-wrap items-center gap-x-12 gap-y-4 border-b border-white/15 pb-10">
          <FamilyWordmark product="" />
          <FamilyWordmark product="Pay" />
          <FamilyWordmark product="Docket" />
          <FamilyWordmark product="Peer" />
        </div>

        {/* link columns — tier 1 */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 pt-12 md:grid-cols-5">
          <div>
            <h4 className="mb-5 text-xl font-bold">Get in touch</h4>
            <ul className="space-y-3 text-[15px] text-white/80">
              <li>Hours: Mon–Fri 6am–5pm CST</li>
              <li>Contact Support: (800) 571-8062</li>
              <li>Contact Sales: (800) 462-8173</li>
              <li><a href="/coming-soon" className="hover:text-white">Contact us</a></li>
            </ul>
          </div>
          {COLS.map((col) => (
            <div key={col.title}>
              <h4 className="mb-5 text-xl font-bold">{col.title}</h4>
              <ul className="space-y-3 text-[15px] text-white/80">
                {col.links.map((l) => (
                  <li key={l.label}><Link to={l.to} className="hover:text-white">{l.label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* tier 2 */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 pt-14 md:grid-cols-5">
          <div className="hidden md:block" />
          {COLS2.map((col) => (
            <div key={col.title}>
              <h4 className="mb-5 text-xl font-bold">{col.title}</h4>
              <ul className="space-y-3 text-[15px] text-white/80">
                {col.links.map((l) => (
                  <li key={l.label}><Link to={l.to} className="hover:text-white">{l.label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 border-t border-white/15 pt-8">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <ul className="flex flex-wrap gap-x-2 gap-y-2 text-[13px] text-white/80">
              {["Privacy Policy", "Terms of Service", "Accessibility Statement", "Cookies", "Do Not Sell or Share My Personal Information", "LLM Info"].map((l, i, arr) => (
                <li key={l} className="flex items-center gap-2">
                  <a href="/coming-soon" className="hover:text-white">{l}</a>
                  {i < arr.length - 1 && <span className="text-white/30">|</span>}
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-5">
              <a href="/coming-soon" aria-label="LinkedIn"><SocialIcon kind="linkedin" /></a>
              <a href="/coming-soon" aria-label="YouTube"><SocialIcon kind="youtube" /></a>
              <a href="/coming-soon" aria-label="X"><SocialIcon kind="x" /></a>
              <a href="/coming-soon" aria-label="Facebook"><SocialIcon kind="facebook" /></a>
            </div>
          </div>
          <div className="mt-6 space-y-1 text-[12px] leading-5 text-white/60">
            <p>© 2026 Lawleit Legal Software, LLC. All Rights Reserved</p>
            <p>Lawleit™ is a trademark of Lawleit Legal Software, LLC. Registration pending.</p>
            <p>Lawleit operates as an independent software platform. All product names are property of Lawleit Legal Software, LLC.</p>
            <p>All trademarks, service marks, and brand names mentioned in this document are the exclusive property of their respective owners.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
