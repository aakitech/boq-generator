import Footer from "@/components/Footer";
import DemoVideo from "@/components/DemoVideo";
import WaitlistForm from "@/components/WaitlistForm";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <nav className="fixed top-0 left-0 right-0 z-20 border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <a href="/">
            <img src="/boqlogo.png" alt="BOQ Generator" className="h-7 w-auto" width="120" height="28" />
          </a>
          <div className="flex items-center gap-3 sm:gap-4">
            <a href="/dashboard" className="hidden text-xs text-gray-400 transition-colors hover:text-white sm:block">
              Dashboard
            </a>
            <a href="/upload" className="rounded-lg bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10">
              Try for free
            </a>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative px-4 pb-20 pt-36 sm:pb-24 sm:pt-40">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute left-1/2 top-24 h-[520px] w-[760px] -translate-x-1/2 rounded-full bg-amber-500/10 blur-[150px]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.10),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_55%)]" />
          </div>
          <div className="relative z-10 mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              Built for Southern African construction
            </div>
            <h1 className="mt-6 text-5xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
              SOW to tender-ready BOQ.<br />
              <span className="text-amber-400">In minutes.</span>
            </h1>
            <p className="mt-6 mx-auto max-w-xl text-lg leading-relaxed text-gray-400">
              Upload a Scope of Work. Get a structured, rated Bill of Quantities you can edit and export.
              1,000 starter credits on every account.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-center">
              <a href="/upload" className="rounded-xl bg-amber-400 px-8 py-4 text-base font-bold text-black transition-colors hover:bg-amber-300">
                Try for free
              </a>
              <a href="#waitlist" className="rounded-xl bg-white/5 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-white/10">
                Join the waitlist
              </a>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
          <div className="mb-10 text-center">
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-amber-400/80">How it works</p>
          </div>
          <DemoVideo />
          <div className="grid gap-6 md:grid-cols-3 mt-10">
            {[
              { step: "01", title: "Upload scope", desc: "PDF or Word SOW. Drawings and schedules optional." },
              { step: "02", title: "Generate BOQ", desc: "AI extracts items, quantities, and bill structure." },
              { step: "03", title: "Review & export", desc: "Edit in-browser, then download rated Excel." },
            ].map((item) => (
              <div key={item.step} className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                <p className="font-mono text-3xl font-bold text-amber-400/30">{item.step}</p>
                <h3 className="mt-4 text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <a href="/upload" className="inline-flex rounded-xl bg-amber-400 px-8 py-4 text-base font-semibold text-black transition-colors hover:bg-amber-300">
              Try for free
            </a>
          </div>
        </section>

        {/* Features + Audience */}
        <section className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8">
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-amber-300">What you get</p>
              <div className="mt-6 space-y-3">
                {[
                  "SOW → structured BOQ draft",
                  "AI rates calibrated to Zambian market",
                  "Edit line items in the browser",
                  "Export original Excel with rates filled in",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                    </svg>
                    <span className="text-sm text-gray-300">{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8">
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-amber-300">Who it&apos;s for</p>
              <div className="mt-6 space-y-3">
                {[
                  "Contractors preparing tender submissions",
                  "Estimators who need faster first drafts",
                  "QS consultants who want cleaner BOQ structure",
                  "Project teams comparing early pricing options",
                ].map((item) => (
                  <div key={item} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                    <p className="text-sm text-gray-300">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section className="mx-auto max-w-6xl px-4 py-10 pb-24 text-center">
          <h2 className="text-2xl font-bold text-white mb-2">Pricing</h2>
          <p className="text-gray-400 text-sm mb-10">Start free. Pay per BOQ once credits are used.</p>
          <div className="inline-block rounded-2xl border border-amber-500/30 bg-[#0f0f0f] p-8 text-left min-w-[280px]">
            <p className="text-5xl font-bold text-amber-400 mb-1">$20 – $500</p>
            <p className="text-gray-400 text-sm mb-6">one-time per BOQ · based on project size</p>
            <ul className="space-y-2 mb-8">
              {["Structured BOQ", "In-browser editing", "Excel export", "Saved to your account"].map((item) => (
                <li key={item} className="flex items-center gap-2 text-sm text-gray-300">
                  <svg className="w-4 h-4 text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
            <a href="/upload" className="block w-full py-3.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-bold text-sm text-center transition-colors">
              Try for free
            </a>
          </div>
        </section>

        {/* Waitlist */}
        <section id="waitlist" className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
          <div className="text-center mb-10">
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-amber-300">Waitlist</p>
            <h2 className="mt-3 text-3xl font-bold text-white">Get early access</h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-gray-400">
              Leave your details and we&apos;ll reach out when BOQ Generator is ready.
            </p>
          </div>
          <WaitlistForm />
        </section>
      </main>

      <Footer />
    </div>
  );
}
