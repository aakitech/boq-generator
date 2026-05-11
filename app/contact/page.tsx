import Footer from "@/components/Footer";

export const metadata = {
  title: "Contact & Support — BOQ Generator",
};

const SUPPORT_EMAIL = "boq-support@aakitech.com";

export default function ContactPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <nav className="border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <a href="/" className="text-sm font-semibold text-white">
            BOQ <span className="text-amber-400">Generator</span>
          </a>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto px-4 py-16 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Contact & Support</h1>
          <p className="text-sm text-gray-500">We&apos;re here to help.</p>
        </div>

        {/* Primary contact */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 space-y-4">
          <h2 className="text-base font-semibold text-white">Email support</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            For help with your BOQ, payment issues, refund requests, or any other questions, email us directly:
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-amber-400 hover:bg-amber-300 text-black font-semibold text-sm transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            {SUPPORT_EMAIL}
          </a>
          <p className="text-xs text-gray-600">
            We aim to respond within 1 business day.
          </p>
        </div>

        {/* FAQ */}
        <div className="space-y-5">
          <h2 className="text-base font-semibold text-white">Common questions</h2>

          {[
            {
              q: "My BOQ didn't generate — what do I do?",
              a: "Email us at boq-support@aakitech.com with your payment reference and a description of what happened. We will investigate and either re-run your generation or issue a refund in line with our Refund Policy.",
            },
            {
              q: "I paid but the page didn't redirect back correctly.",
              a: "Your payment was likely successful. Log in to your account and check 'My BOQs' — your BOQ may already be there. If not, email us at boq-support@aakitech.com with your payment reference and we will sort it out.",
            },
            {
              q: "Can I request a refund?",
              a: "Yes, in certain cases. Please read our Refund Policy on the Terms of Service page, then contact us at boq-support@aakitech.com with your payment reference.",
            },
            {
              q: "The BOQ quality is poor — what should I do?",
              a: "Use the AI BOQ Assistant (available on your BOQ page) to refine and improve the output. If the issue is a system error rather than a challenging document, contact us.",
            },
            {
              q: "Can I upload a scanned PDF?",
              a: "No — scanned PDFs are images and contain no extractable text. Please use a text-based PDF or a Word document. If your document is scanned, you will need to run it through an OCR tool first.",
            },
            {
              q: "Is my Scope of Work document stored on your servers?",
              a: "No. The raw file is never stored. Only the extracted text and your generated BOQ are saved to your account. See our Privacy Policy for full details.",
            },
          ].map((item) => (
            <div key={item.q} className="border-b border-white/5 pb-5 space-y-2">
              <p className="text-sm font-medium text-white">{item.q}</p>
              <p className="text-sm text-gray-400 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>

        {/* Data/privacy */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-3">
          <h2 className="text-base font-semibold text-white">Privacy & data requests</h2>
          <p className="text-sm text-gray-400 leading-relaxed">
            To request access to, correction of, or deletion of your personal data — as provided under GDPR and POPIA — please email us at{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-amber-400 hover:underline">{SUPPORT_EMAIL}</a>{" "}
            with the subject line &ldquo;Data Request&rdquo;. We will respond within 30 days.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
