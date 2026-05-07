import Footer from "@/components/Footer";
import WaitlistForm from "@/components/WaitlistForm";
import DemoVideo from "@/components/DemoVideo";

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
            <a href="/upload" className="rounded bg-[#f59e0b] hover:bg-[#fbbf24] px-4 py-2 text-[13px] font-semibold text-black transition-colors">
              Try for free
            </a>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero */}
        <section className="px-6 pt-36 pb-20 sm:pt-44 sm:pb-28">
          <div className="mx-auto max-w-[960px]">
            <p className="text-[11px] font-medium tracking-[0.1em] uppercase text-[#f59e0b] mb-5">
              BOQ Generator · Precision tooling for QSs
            </p>
            <h1 className="font-serif text-[clamp(36px,5.5vw,60px)] leading-[1.08] font-normal tracking-[-0.025em] max-w-[640px] mb-5">
              Precision tooling for <em className="not-italic italic text-[#737373]">Quantity Surveyors</em> across Southern Africa.
            </h1>
            <p className="text-[15px] text-[#737373] max-w-[440px] leading-relaxed mb-8">
              Upload your SoW and drawings. Get a structured, priced Bill of Quantities in under a minute — calibrated to your province and project type.
            </p>
            <div className="flex gap-3 items-center">
              <a href="/upload" className="rounded bg-[#f59e0b] hover:bg-[#fbbf24] px-5 py-[10px] text-[13px] font-semibold text-black transition-colors">
                Generate BOQ →
              </a>
              <a href="#updates" className="rounded border border-[#262626] hover:bg-[#111] px-5 py-[10px] text-[13px] text-[#737373] transition-colors">
                Stay updated
              </a>
            </div>
            <div className="mt-12 pt-10 border-t border-[#262626] flex gap-10">
              <div>
                <div className="font-mono text-[20px] font-medium tracking-[-0.03em] text-[#f5f5f5]">ZMW</div>
                <div className="text-[11px] text-[#737373] mt-0.5">Zambian rates built in</div>
              </div>
              <div>
                <div className="font-mono text-[20px] font-medium tracking-[-0.03em] text-[#f5f5f5]">&lt;60s</div>
                <div className="text-[11px] text-[#737373] mt-0.5">Generation time</div>
              </div>
              <div>
                <div className="font-mono text-[20px] font-medium tracking-[-0.03em] text-[#f5f5f5]">.xlsx</div>
                <div className="text-[11px] text-[#737373] mt-0.5">Tender-ready export</div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-[#1c1c1c] mx-auto max-w-[960px] px-6 py-16 sm:py-20">
          <p className="text-[11px] font-medium tracking-[0.08em] uppercase text-[#404040] mb-8">How it works</p>
          <div className="mb-10">
            <DemoVideo />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { step: "01", title: "Upload your documents", desc: "SoW, drawings, schedules — drop them all in. Up to 6 files, 50 MB each." },
              { step: "02", title: "Generate BOQ", desc: "AI builds a structured, priced bill of quantities. Runs in the background — no waiting." },
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
            <a href="/upload" className="inline-block rounded bg-[#f59e0b] hover:bg-[#fbbf24] px-8 py-3 text-[13px] font-semibold text-black transition-colors">
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

        {/* Pricing */}
        <section className="border-t border-[#1c1c1c] mx-auto max-w-[960px] px-6 py-12 pb-24">
          <h2 className="font-serif text-[28px] font-normal text-[#f5f5f5] mb-2">Pricing</h2>
          <p className="text-[#737373] text-[13px] mb-10">Start free. Top up credits when you need more.</p>
          <div className="grid gap-4 sm:grid-cols-3 max-w-xl">
            {[
              { label: "$20", credits: "500 credits", note: "~1 BOQ" },
              { label: "$50", credits: "1,250 credits", note: "~2–3 BOQs" },
              { label: "$100", credits: "2,500 credits", note: "~5+ BOQs" },
            ].map((tier) => (
              <div key={tier.label} className="rounded-[8px] border border-[#262626] bg-[#111] p-5">
                <p className="font-mono text-[24px] font-medium text-[#f5f5f5] mb-1">{tier.label}</p>
                <p className="text-[12px] text-[#f59e0b] font-mono mb-1">{tier.credits}</p>
                <p className="text-[12px] text-[#737373]">{tier.note}</p>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-[#404040] mt-4">Every new account gets 1,000 free credits — enough for ~2 BOQs.</p>
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
