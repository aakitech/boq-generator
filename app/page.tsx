import Footer from "@/components/Footer";
import WaitlistForm from "@/components/WaitlistForm";
import DemoVideo from "@/components/DemoVideo";

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "boq@aakitech.com";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <nav className="fixed top-0 left-0 right-0 z-20 border-b border-[#262626] bg-[#0a0a0a]/92 backdrop-blur">
        <div className="mx-auto flex max-w-[960px] items-center justify-between px-6" style={{ height: 48 }}>
          <div className="flex items-center gap-2 text-[13px] font-medium text-[#f5f5f5]">
            <div className="w-[7px] h-[7px] rounded-full bg-[#f59e0b]" />
            BOQ Generator
          </div>
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="text-[12px] text-[#737373] hover:text-[#f5f5f5] transition-colors hidden sm:block">Dashboard</a>
            <a href="/upload" className="rounded border border-[#262626] hover:bg-[#111] px-4 py-1.5 text-[12px] text-[#737373] transition-colors hidden sm:block">
              Self-serve
            </a>
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=Tender%20Pack%20Request`}
              className="rounded bg-[#f59e0b] hover:bg-[#fbbf24] px-4 py-2 text-[13px] font-semibold text-black transition-colors"
            >
              Get a quote
            </a>
          </div>
        </div>
      </nav>

      <main className="flex-1">

        {/* Hero — service-first */}
        <section className="px-6 pt-36 pb-20 sm:pt-44 sm:pb-28">
          <div className="mx-auto max-w-[960px]">
            <p className="text-[11px] font-medium tracking-[0.1em] uppercase text-[#f59e0b] mb-5">
              BOQ Generator · Tender Pack Service
            </p>
            <h1 className="font-serif text-[clamp(36px,5.5vw,60px)] leading-[1.08] font-normal tracking-[-0.025em] max-w-[660px] mb-5">
              Send us your project documents.<br />
              <em className="not-italic italic text-[#737373]">We send back your tender pack.</em>
            </h1>
            <p className="text-[15px] text-[#737373] max-w-[480px] leading-relaxed mb-8">
              Email your Scope of Work and drawings. We prepare your Bill of Quantities, Method Statement, Programme of Works, and more — calibrated to Zambian rates, ready for submission.
            </p>
            <div className="flex gap-3 items-center flex-wrap">
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=Tender%20Pack%20Request&body=Hi%2C%20I%20would%20like%20to%20request%20a%20tender%20pack%20for%20my%20project.%0A%0AProject%20name%3A%20%0AScope%3A%20%0ALocation%3A%20`}
                className="rounded bg-[#f59e0b] hover:bg-[#fbbf24] px-5 py-[10px] text-[13px] font-semibold text-black transition-colors"
              >
                Get your tender pack →
              </a>
              <a href="/upload" className="rounded border border-[#262626] hover:bg-[#111] px-5 py-[10px] text-[13px] text-[#737373] transition-colors">
                Do it yourself
              </a>
            </div>
            <div className="mt-12 pt-10 border-t border-[#262626] flex gap-10 flex-wrap">
              <div>
                <div className="font-mono text-[20px] font-medium tracking-[-0.03em] text-[#f5f5f5]">24–48h</div>
                <div className="text-[11px] text-[#737373] mt-0.5">Turnaround time</div>
              </div>
              <div>
                <div className="font-mono text-[20px] font-medium tracking-[-0.03em] text-[#f5f5f5]">$50–200</div>
                <div className="text-[11px] text-[#737373] mt-0.5">Fixed price per pack</div>
              </div>
              <div>
                <div className="font-mono text-[20px] font-medium tracking-[-0.03em] text-[#f5f5f5]">Zambian</div>
                <div className="text-[11px] text-[#737373] mt-0.5">Rates from real tender data</div>
              </div>
              <div>
                <div className="font-mono text-[20px] font-medium tracking-[-0.03em] text-[#f5f5f5]">.xlsx</div>
                <div className="text-[11px] text-[#737373] mt-0.5">Delivered to your inbox</div>
              </div>
            </div>
          </div>
        </section>

        {/* How the service works */}
        <section className="border-t border-[#1c1c1c] mx-auto max-w-[960px] px-6 py-16 sm:py-20">
          <p className="text-[11px] font-medium tracking-[0.08em] uppercase text-[#404040] mb-8">How the service works</p>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Email us your documents",
                desc: `Send your Scope of Work and any drawings to ${CONTACT_EMAIL}. We confirm scope and agree a price — typically within a few hours.`,
              },
              {
                step: "02",
                title: "We build your pack",
                desc: "AI generates a structured, priced BOQ. Our team reviews it, checks against Zambian rate benchmarks, and approves it before sending.",
              },
              {
                step: "03",
                title: "Receive and submit",
                desc: "You get a complete, formatted Excel file — ready to attach to your tender submission. Reply if you need adjustments.",
              },
            ].map((item) => (
              <div key={item.step} className="rounded-[8px] border border-[#262626] bg-[#111] p-6">
                <p className="font-mono text-[24px] font-bold text-[#262626] mb-4">{item.step}</p>
                <h3 className="text-[13px] font-semibold text-[#f5f5f5] mb-2">{item.title}</h3>
                <p className="text-[12px] leading-relaxed text-[#737373]">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=Tender%20Pack%20Request`}
              className="inline-block rounded bg-[#f59e0b] hover:bg-[#fbbf24] px-8 py-3 text-[13px] font-semibold text-black transition-colors"
            >
              Request your tender pack
            </a>
          </div>
        </section>

        {/* Service tier pricing */}
        <section className="border-t border-[#1c1c1c] mx-auto max-w-[960px] px-6 py-12 sm:py-14">
          <p className="text-[11px] font-medium tracking-[0.08em] uppercase text-[#404040] mb-8">Service pricing</p>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                name: "BOQ Only",
                price: "$50",
                turnaround: "24h",
                items: [
                  "Priced Bill of Quantities",
                  "ZMW rates by province",
                  "Excel format (.xlsx)",
                  "One revision included",
                ],
              },
              {
                name: "BOQ + Tender Pack",
                price: "$120",
                turnaround: "48h",
                highlight: true,
                items: [
                  "Everything in BOQ Only",
                  "Method Statement",
                  "Programme of Works",
                  "Preliminaries section",
                  "Resource Schedule",
                ],
              },
              {
                name: "Full Submission Pack",
                price: "$200",
                turnaround: "72h",
                items: [
                  "Everything in Tender Pack",
                  "Priced Activity Schedule",
                  "Cover Letter / Scope Note",
                  "Two revision rounds",
                ],
              },
            ].map((tier) => (
              <div
                key={tier.name}
                className={`rounded-[8px] border p-6 relative ${
                  tier.highlight
                    ? "border-[#f59e0b]/40 bg-[#f59e0b]/5"
                    : "border-[#262626] bg-[#111]"
                }`}
              >
                {tier.highlight && (
                  <span className="absolute top-3 right-3 font-mono text-[10px] uppercase tracking-wide text-[#f59e0b] bg-[#f59e0b]/10 px-1.5 py-0.5 rounded">
                    Most popular
                  </span>
                )}
                <p className="text-[13px] font-semibold text-[#f5f5f5] mb-1">{tier.name}</p>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="font-mono text-[28px] font-medium text-[#f5f5f5]">{tier.price}</span>
                </div>
                <p className="text-[11px] text-[#525252] mb-4">Delivered within {tier.turnaround}</p>
                <ul className="space-y-2">
                  {tier.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[12px] text-[#d4d4d4]">
                      <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#f59e0b]" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-[#404040] mt-5">
            Payment via MoMo, Airtel Money, or bank transfer. We confirm before starting work.
            Contact us at <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#737373] hover:text-[#f5f5f5] transition-colors">{CONTACT_EMAIL}</a>
          </p>
        </section>

        {/* Divider — self-serve section */}
        <section className="border-t border-[#1c1c1c] mx-auto max-w-[960px] px-6 py-10">
          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-[#1c1c1c]" />
            <p className="text-[11px] font-medium tracking-[0.08em] uppercase text-[#404040]">Or do it yourself</p>
            <div className="flex-1 h-px bg-[#1c1c1c]" />
          </div>
          <p className="text-[13px] text-[#737373] text-center mt-4 max-w-[440px] mx-auto">
            Prefer to generate your own BOQ? Upload your documents and get a structured, priced bill in ~10 minutes. Start free.
          </p>
          <div className="text-center mt-6">
            <a href="/upload" className="inline-block rounded border border-[#262626] hover:bg-[#111] px-6 py-2.5 text-[13px] text-[#737373] transition-colors">
              Generate BOQ yourself →
            </a>
          </div>
        </section>

        {/* How self-serve works */}
        <section className="border-t border-[#1c1c1c] mx-auto max-w-[960px] px-6 py-12 sm:py-14">
          <p className="text-[11px] font-medium tracking-[0.08em] uppercase text-[#404040] mb-8">How self-serve works</p>
          <div className="mb-10">
            <DemoVideo />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { step: "01", title: "Upload your documents", desc: "SoW, drawings, schedules — drop them all in. Up to 6 files, 50 MB each." },
              { step: "02", title: "Generate BOQ", desc: "AI builds a structured, priced bill of quantities. Runs in the background — typically ready in 10 minutes." },
              { step: "03", title: "Review & export", desc: "Edit line items in-browser, chat with the assistant, then download a rated Excel." },
            ].map((item) => (
              <div key={item.step} className="rounded-[8px] border border-[#262626] bg-[#111] p-6">
                <p className="font-mono text-[24px] font-bold text-[#262626] mb-4">{item.step}</p>
                <h3 className="text-[13px] font-semibold text-[#f5f5f5] mb-2">{item.title}</h3>
                <p className="text-[12px] leading-relaxed text-[#737373]">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <a href="/upload" className="inline-block rounded border border-[#262626] hover:bg-[#111] px-8 py-3 text-[13px] text-[#737373] transition-colors">
              Try for free
            </a>
          </div>
        </section>

        {/* What you get / Who it's for */}
        <section className="border-t border-[#1c1c1c] mx-auto max-w-[960px] px-6 py-12 sm:py-14">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[8px] border border-[#262626] bg-[#111] p-6">
              <p className="text-[11px] font-medium tracking-[0.08em] uppercase text-[#404040] mb-5">What you get</p>
              <div className="space-y-3">
                {[
                  "SoW + drawings → fully structured BOQ",
                  "ZMW rates calibrated to your province and project type",
                  "Edit and approve line items in the browser",
                  "Export a rated Excel ready for tender submission",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-[#f59e0b]" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                    </svg>
                    <span className="text-[13px] text-[#d4d4d4]">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[8px] border border-[#262626] bg-[#111] p-6">
              <p className="text-[11px] font-medium tracking-[0.08em] uppercase text-[#404040] mb-5">Who it&apos;s for</p>
              <div className="space-y-2">
                {[
                  "Contractors preparing tender submissions",
                  "Estimators who need faster first drafts",
                  "QS consultants who want cleaner BOQ structure",
                  "Project teams comparing early pricing options",
                ].map((item) => (
                  <div key={item} className="rounded border border-[#262626] px-4 py-3">
                    <p className="text-[13px] text-[#d4d4d4]">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Self-serve pricing */}
        <section className="border-t border-[#1c1c1c] mx-auto max-w-[960px] px-6 py-12 pb-24">
          <h2 className="font-serif text-[22px] font-normal text-[#f5f5f5] mb-1">Self-serve pricing</h2>
          <p className="text-[#737373] text-[13px] mb-8">Start free. Top up credits when you need more.</p>

          <div className="mb-8 space-y-1.5">
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#404040] w-36 flex-shrink-0">Rate Existing BOQ</span>
              <span className="font-mono text-[12px] text-[#737373]">500 credits</span>
              <span className="text-[12px] text-[#404040]">·</span>
              <span className="font-mono text-[12px] text-[#404040]">$20 flat</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#404040] w-36 flex-shrink-0">Generate New BOQ</span>
              <span className="font-mono text-[12px] text-[#737373]">from 500 credits</span>
              <span className="text-[12px] text-[#404040]">·</span>
              <span className="font-mono text-[12px] text-[#404040]">+150 credits per doc above 5</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 max-w-xl mb-6">
            {[
              { label: "$20",  credits: "500 credits",   note: "1 rated BOQ or 1 generate job (up to 5 docs)" },
              { label: "$50",  credits: "1,250 credits", note: "2–3 rated BOQs or 1 generate job with drawings" },
              { label: "$100", credits: "2,500 credits", note: "5+ rated BOQs or large generate jobs" },
            ].map((tier) => (
              <div key={tier.label} className="rounded-[8px] border border-[#262626] bg-[#111] p-5">
                <p className="font-mono text-[24px] font-medium text-[#f5f5f5] mb-1">{tier.label}</p>
                <p className="text-[12px] text-[#f59e0b] font-mono mb-2">{tier.credits}</p>
                <p className="text-[11px] text-[#525252] leading-snug">{tier.note}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 mb-4 max-w-xl">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#404040]">Firm &amp; Enterprise</span>
            <div className="flex-1 h-px bg-[#262626]" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
            {[
              { label: "$500",   credits: "14,000 credits", note: "Firm pack — 28 rated BOQs or 5+ generate jobs",   badge: "10% off" },
              { label: "$1,000", credits: "30,000 credits", note: "Enterprise — 60 rated BOQs or 12+ generate jobs", badge: "17% off" },
            ].map((tier) => (
              <div key={tier.label} className="relative rounded-[8px] border border-[#262626] bg-[#1a1a1a] p-5">
                <span className="absolute top-3 right-3 font-mono text-[10px] uppercase tracking-wide text-[#f59e0b] bg-[#f59e0b]/10 px-1.5 py-0.5 rounded">
                  {tier.badge}
                </span>
                <p className="font-mono text-[24px] font-medium text-[#f5f5f5] mb-1">{tier.label}</p>
                <p className="text-[12px] text-[#f59e0b] font-mono mb-2">{tier.credits}</p>
                <p className="text-[11px] text-[#525252] leading-snug">{tier.note}</p>
              </div>
            ))}
          </div>

          <p className="text-[12px] text-[#404040] mt-5">Every new account gets 1,000 free credits — enough for 2 rated BOQs or 1 generate job with drawings.</p>
        </section>

        {/* Updates */}
        <section id="updates" className="border-t border-[#1c1c1c] mx-auto max-w-[960px] px-6 py-12 pb-20">
          <h2 className="font-serif text-[28px] font-normal text-[#f5f5f5] mb-2">Stay in the loop</h2>
          <p className="text-[#737373] text-[13px] mb-8 max-w-md">New features, rate updates, and product news — straight to your inbox.</p>
          <WaitlistForm />
        </section>
      </main>

      <Footer />
    </div>
  );
}
