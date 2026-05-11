import Footer from "@/components/Footer";

export const metadata = {
  title: "Terms of Service — BOQ Generator",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <nav className="border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <a href="/" className="text-sm font-semibold text-white">
            BOQ <span className="text-amber-400">Generator</span>
          </a>
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto px-4 py-16 space-y-10 text-gray-300">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Terms of Service</h1>
          <p className="text-sm text-gray-500">Last updated: 18 March 2026</p>
        </div>

        <p className="text-sm leading-relaxed">
          Please read these Terms of Service (&ldquo;Terms&rdquo;) carefully before using BOQ Generator (&ldquo;the Service&rdquo;). By accessing or using the Service, you agree to be bound by these Terms.
        </p>

        <Section title="1. The Service">
          <p>BOQ Generator is an AI-powered tool that generates Bills of Quantities (BOQs) from uploaded Scope of Work documents. The Service uses AI language models to extract and structure content from your documents.</p>
          <p className="mt-2 font-medium text-yellow-300">Important: All AI-generated BOQs are provided as a starting point only. You are responsible for reviewing, verifying, and validating all quantities, descriptions, units, and rates before use in any tender, contract, or construction project. BOQ Generator and its operators accept no liability for errors, omissions, or inaccuracies in generated outputs.</p>
        </Section>

        <Section title="2. Eligibility">
          <p>You must be at least 18 years of age and have the legal capacity to enter into contracts to use this Service. By using the Service, you represent that you meet these requirements.</p>
        </Section>

        <Section title="3. Payment & Credits">
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>The Service operates on a credit wallet. New accounts receive starter credits on sign-up. Additional credits can be purchased via MoMo, Airtel Money, or bank transfer.</li>
            <li>Credits are deducted when AI work is completed (BOQ generation, rate-filling, or AI assistant proposals).</li>
            <li>Credit top-ups are processed manually. Once payment is confirmed by our team, credits are added to your wallet within 1 business day.</li>
            <li>Credit balances are non-transferable and non-refundable except in cases of service failure (see Refund Policy below).</li>
          </ul>
        </Section>

        <Section title="4. Refund Policy">
          <p>We want you to be satisfied with the Service. Our refund policy is as follows:</p>
          <ul className="list-disc pl-5 space-y-1 text-sm mt-2">
            <li><strong className="text-white">Technical failure:</strong> If the Service fails to generate a BOQ due to a technical error on our side and you are unable to download any output, you are entitled to a credit refund or re-generation. Contact us within 7 days.</li>
            <li><strong className="text-white">Poor-quality output:</strong> If the generated BOQ is clearly unusable due to a failure in our AI system (e.g., entirely blank, garbled output), contact us and we will review your case. We may offer a re-generation or credit refund at our discretion.</li>
            <li><strong className="text-white">Unsuitable document:</strong> If you uploaded a document that is not a Scope of Work and received a poor-quality BOQ as a result, refunds are not guaranteed. We provide a document validation step before processing to help prevent this.</li>
            <li><strong className="text-white">Change of mind:</strong> Credits are not refunded after BOQ generation has been initiated, as the AI processing cost has been incurred.</li>
          </ul>
          <p className="mt-3 text-sm">To request a refund, contact us via the <a href="/contact" className="text-amber-400 hover:underline">Contact page</a> with a brief description of the issue.</p>
        </Section>

        <Section title="5. Acceptable use">
          <p>You agree not to:</p>
          <ul className="list-disc pl-5 space-y-1 text-sm mt-2">
            <li>Upload documents containing illegal content, malware, or material that infringes third-party intellectual property rights.</li>
            <li>Attempt to reverse-engineer, scrape, or abuse the Service in a way that disrupts other users.</li>
            <li>Use the Service for any unlawful purpose.</li>
          </ul>
        </Section>

        <Section title="6. Intellectual property">
          <p>The BOQ output generated from your document is provided to you for your use. You retain ownership of your source documents. The AI model prompts, system architecture, and codebase of BOQ Generator remain our intellectual property.</p>
        </Section>

        <Section title="7. Disclaimer of warranties">
          <p>The Service is provided &ldquo;as is&rdquo; without warranties of any kind, express or implied. We do not warrant that the generated BOQs will be accurate, complete, or fit for any particular purpose. AI-generated content can contain errors and must be reviewed by a qualified professional before use.</p>
        </Section>

        <Section title="8. Limitation of liability">
          <p>To the maximum extent permitted by law, BOQ Generator and its operators shall not be liable for any indirect, incidental, consequential, or punitive damages arising from your use of the Service, including but not limited to losses arising from reliance on AI-generated BOQ content in a tender or construction project.</p>
          <p className="mt-2">Our total liability to you for any claim arising from use of the Service shall not exceed the amount you paid for the specific BOQ generation that gave rise to the claim.</p>
        </Section>

        <Section title="9. Governing law">
          <p>These Terms are governed by the laws of the Republic of Zambia. Any disputes shall be subject to the jurisdiction of the courts of Zambia.</p>
        </Section>

        <Section title="10. Changes to these Terms">
          <p>We may update these Terms from time to time. Continued use of the Service after changes constitutes your acceptance of the revised Terms. We will notify registered users of material changes by email.</p>
        </Section>

        <Section title="11. Contact">
          <p>For questions about these Terms, contact us via the <a href="/contact" className="text-amber-400 hover:underline">Contact page</a>.</p>
        </Section>
      </main>

      <Footer />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      <div className="text-sm leading-relaxed space-y-2">{children}</div>
    </section>
  );
}
