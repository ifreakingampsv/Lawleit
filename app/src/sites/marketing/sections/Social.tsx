import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import EmailCapture from "./EmailCapture";
import { PlayButton } from "./Features";
import { cn } from "@/lib/utils";

/* ---- S12: Do more panel ---- */

const DO_MORE = [
  {
    title: "Easy onboarding",
    icon: "M4 8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v3a4 4 0 0 1-4 4h-2l-4 4v-4H8a4 4 0 0 1-4-4zM8 9h8M8 6h5",
    paras: [
      "We know your time is valuable. That's why we've designed Lawleit onboarding to be quick, intuitive, and lawyer-friendly, so you can start getting value right away.",
      "With Lawleit, you'll spend less time setting up and more time practicing law. From data migration to training, we've got you covered.",
    ],
    link: "Get training and support",
  },
  {
    title: "Feel safe and secure",
    icon: "M12 3l8 3v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-3zm-3 9l2.5 2.5L16 10",
    paras: [
      "Feel confident knowing that your data is protected with Lawleit bank-grade security measures, so you can focus on practicing law, not cybersecurity.",
      "We safeguard your practice with the highest security standards, ensuring your peace of mind and your clients' trust.",
    ],
    link: "Learn about Lawleit security",
  },
  {
    title: "Connected to your tools",
    icon: "M9 9h6v6H9zM4 4h5v5H4zM15 15h5v5h-5zM4 15h5v5H4zM15 4h5v5h-5z",
    paras: [
      "Run the core of your firm in one place. Manage cases, billing, payments, and client communication from one platform, and integrate Lawleit with the tools you already use. Data you enter once shows up everywhere it should, with no double entry.",
    ],
    link: "Explore Lawleit integrations",
  },
];

export function DoMore() {
  return (
    <section className="bg-[#f0f0ee] py-20">
      <div className="mx-auto max-w-[1280px] px-8">
        <div className="rounded-3xl bg-white px-14 py-14 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-display text-[40px] font-bold tracking-tight text-neutral-900">Do more with Lawleit</h2>
              <p className="mt-2 text-lg text-neutral-700">We have the details covered, so you can worry less.</p>
            </div>
            <button className="rounded-full bg-lawleit px-6 py-3 text-[15px] font-bold text-white transition hover:bg-lawleit-dark">
              See all features
            </button>
          </div>
          <div className="mt-12 grid grid-cols-3 gap-12">
            {DO_MORE.map((c) => (
              <div key={c.title}>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#eceafb]">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#4c4cb8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={c.icon} /></svg>
                </span>
                <h3 className="mt-5 text-2xl font-bold text-neutral-900">{c.title}</h3>
                {c.paras.map((p) => <p key={p.slice(0, 24)} className="mt-3 text-[15px] leading-relaxed text-neutral-600">{p}</p>)}
                <a href="/coming-soon" className="mt-5 inline-flex items-center gap-1 text-[15px] font-semibold text-lawleit hover:text-lawleit-dark">
                  {c.link} <ChevronRight className="h-4 w-4" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---- S13: Video testimonial ---- */

export function VideoTestimonial() {
  return (
    <section className="bg-[#f0f0ee] pb-24 pt-4">
      <div className="mx-auto grid max-w-[1280px] grid-cols-[1fr_1.2fr] items-center gap-14 px-8">
        <div className="relative h-[290px] overflow-hidden rounded-lg bg-[radial-gradient(140%_120%_at_30%_20%,#4a5a63_0%,#26323a_60%,#182026_100%)]">
          <div className="absolute inset-x-0 bottom-0 h-16 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%2264%22><rect x=%220%22 y=%2224%22 width=%2218%22 height=%2240%22 fill=%22%231b252b%22/><rect x=%2224%22 y=%2216%22 width=%2214%22 height=%2248%22 fill=%22%23162026%22/><rect x=%2244%22 y=%2230%22 width=%2222%22 height=%2234%22 fill=%22%231d2830%22/><rect x=%2272%22 y=%2220%22 width=%2216%22 height=%2244%22 fill=%22%23162026%22/><rect x=%2294%22 y=%2232%22 width=%2220%22 height=%2232%22 fill=%22%231b252b%22/></svg>'))]" />
          <div className="absolute left-10 top-1/2 -translate-y-1/2 text-2xl font-extrabold tracking-tight text-white/95">
            <span className="text-[#e8674a]">Lawleit</span>
            <span className="font-light">Legal</span>
          </div>
          <PlayButton className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        <div>
          <blockquote className="text-[28px] font-bold leading-snug tracking-tight text-neutral-900">
            "Because of Lawleit, we've seen such a growth in the business. Literally going from maybe meeting
            three to four people a day to meeting 15 people a day."
          </blockquote>
          <p className="mt-5 text-[15px] text-neutral-600">— Dana Whitmore Whitmore & Associates, PLLC</p>
        </div>
      </div>
    </section>
  );
}

/* ---- S14: Reviews carousel + [D4] ---- */

const REVIEWS = [
  { quote: "I have been using Lawleit for 6 years. It is an integral part of my practice and I cannot imagine doing it without it. The interface is extremely easy to navigate, the price is affordable, the customer service is impeccable and, they are constantly innovating and evolving.", name: "Omar R." },
  { quote: "We have a small firm, but since using Lawleit we are more organized and file reviews are a breeze. It is extremely user friendly. It has helped us keep track of expenses, upload template documents, which saves time and money. I would recommend this case management system to every law office.", name: "Maya G." },
  { quote: "Lawleit has been beneficial to our firm right off the bat. The more we learn to use it, the more it is beneficial. It keeps everything all together in one place.", name: "Brian E." },
  { quote: "The client interaction and the client portal are among the best things we have ever had to help with communication with the clients.", name: "Shelby C." },
  { quote: "The best thing about this software program is that we only need this one program for all of our needs.", name: "Jessica J." },
  { quote: "The time keeping is incredibly easy to use, the invoicing and ability for clients to pay is fantastic, the ability to execute documents remotely is unparalleled and the chance to communicate with our clients through the portal cannot be beat.", name: "Sam A." },
  { quote: "Lawleit has been the technological, and case management backbone of supporting our firm's case management and ensuring timeliness in our cases.", name: "Amara A." },
  { quote: "I use Lawleit on every single case that I have. As I have become more familiar with the software, I use more and more features. My clients love it and although I am a sole practitioner, I feel very professionally competitive because of the software.", name: "Paige M." },
  { quote: "My experience with Lawleit has always been positive. I am able to contact representatives and provide feedback whenever I need to and suggest things that will enhance my experience.", name: "Shannon W." },
  { quote: "The customer service of Lawleit is amazing. Everyone that I talk with on their support line is very knowledgeable of the software. They are always trying to help any way they can.", name: "Renata T." },
  { quote: "Intake to invoice in one system — our collectors finally see the whole picture, and our clients get a modern experience.", name: "Devon L." },
  { quote: "Trust accounting stopped being scary. Lawleit keeps every dollar flagged, reconciled and audit-ready.", name: "Priya K." },
];

export function Reviews() {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => setIdx((i) => (i + 1) % REVIEWS.length), 5000);
    return () => window.clearInterval(timer.current);
  }, [playing]);

  const r = REVIEWS[idx] ?? REVIEWS[0];
  return (
    <section className="bg-[#f0f0ee] pb-28">
      <div className="mx-auto max-w-[1280px] px-8">
        <h2 className="text-center font-display text-[36px] font-bold tracking-tight text-neutral-900">
          Leading law firms choose Lawleit
        </h2>
        <div data-testid="reviews-carousel" className="relative mx-auto mt-12 max-w-[1100px] overflow-hidden rounded-2xl bg-white px-20 py-14 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.3)]">
          <svg viewBox="0 0 48 32" className="h-10 w-14 fill-[#8f8ce0]" aria-hidden>
            <path d="M0 32V19.2C0 8.6 6.4 1.6 17.6 0l2.4 6.4c-6.4 1.6-9.6 5-10.2 9.6H20V32H0zm28 0V19.2C28 8.6 34.4 1.6 45.6 0L48 6.4c-6.4 1.6-9.6 5-10.2 9.6H48V32H28z" />
          </svg>
          <div key={idx} className="animate-in fade-in duration-300">
            <p className="mx-auto max-w-[880px] text-center text-[24px] font-medium leading-relaxed text-neutral-900">{r.quote}</p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#6f6ce0]/20 text-sm font-bold text-[#4c4cb8]">
                {(r.name ?? "?").slice(0, 1)}
              </span>
              <span className="text-sm font-semibold text-neutral-800">{r.name}</span>
            </div>
          </div>
        </div>
        {/* [D4] controls */}
        <div className="mt-8 flex items-center justify-center gap-4">
          <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 shadow-sm">
            <button
              aria-label={playing ? "Pause carousel" : "Play carousel"}
              onClick={() => setPlaying((p) => !p)}
              className="text-neutral-700"
            >
              {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
            </button>
            {REVIEWS.map((_, i) => (
              <button
                key={i}
                aria-label={`Review ${i + 1}`}
                onClick={() => setIdx(i)}
                className={cn("h-2 rounded-full transition-all", i === idx ? "w-7 bg-neutral-800" : "w-2 bg-neutral-300")}
              />
            ))}
          </div>
          <button
            data-testid="reviews-prev"
            aria-label="Previous review"
            onClick={() => setIdx((i) => (i - 1 + REVIEWS.length) % REVIEWS.length)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
          ><ChevronLeft className="h-5 w-5" /></button>
          <button
            data-testid="reviews-next"
            aria-label="Next review"
            onClick={() => setIdx((i) => (i + 1) % REVIEWS.length)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
          ><ChevronRight className="h-5 w-5" /></button>
        </div>
      </div>
    </section>
  );
}

/* ---- S15: Final CTA ---- */

export function FinalCta() {
  return (
    <section className="bg-[#f0f0ee] pb-20">
      <div className="mx-auto max-w-[1280px] px-8">
        <div className="rounded-3xl bg-white px-10 py-16 shadow-sm">
          <h2 className="text-center font-display text-[40px] font-bold tracking-tight text-neutral-900">
            Run a more profitable firm with Lawleit
          </h2>
          <p className="mt-4 text-center text-lg text-neutral-700">
            Join 19,000+ firms that trust Lawleit to run a more profitable, efficient practice.
          </p>
          <div className="mt-8 flex justify-center">
            <EmailCapture align="center" />
          </div>
        </div>
      </div>
    </section>
  );
}
