"use client";

import { FormEvent, useState } from "react";

const roleOptions = [
  "Quantity Surveyor",
  "Estimator",
  "Contractor",
  "Consultant",
  "Architect",
  "Project Manager",
  "Developer",
  "Procurement",
  "Other",
];

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roleOptions[0]);
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus("idle");
    setMessage("");

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, company, source: "landing_page" }),
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        setStatus("error");
        setMessage(result.error ?? "Something went wrong. Please try again.");
        return;
      }

      setStatus("success");
      if (result.status === "created") {
        setEmail("");
        setCompany("");
        setRole(roleOptions[0]);
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-[8px] border border-[#22c55e]/20 bg-[#22c55e]/5 px-5 py-4 max-w-md">
        <p className="text-[13px] font-medium text-[#22c55e] mb-0.5">You&apos;re in.</p>
        <p className="text-[12px] text-[#737373]">We&apos;ll send updates on new features and improvements to {email || "your inbox"}.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-4">
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium uppercase tracking-[0.08em] text-[#404040] mb-1.5">
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full h-10 rounded bg-[#111] border border-[#262626] px-3 text-[13px] text-[#f5f5f5] placeholder:text-[#404040] outline-none focus:border-[#f59e0b] transition-colors"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-medium uppercase tracking-[0.08em] text-[#404040] mb-1.5">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full h-10 rounded bg-[#111] border border-[#262626] px-3 text-[13px] text-[#f5f5f5] outline-none focus:border-[#f59e0b] transition-colors cursor-pointer"
            >
              {roleOptions.map((option) => (
                <option key={option} value={option} className="bg-[#111]">{option}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium uppercase tracking-[0.08em] text-[#404040] mb-1.5">
              Company
            </label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Your firm or team"
              className="w-full h-10 rounded bg-[#111] border border-[#262626] px-3 text-[13px] text-[#f5f5f5] placeholder:text-[#404040] outline-none focus:border-[#f59e0b] transition-colors"
            />
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded bg-[#f59e0b] hover:bg-[#fbbf24] px-6 py-[10px] text-[13px] font-semibold text-black transition-colors disabled:opacity-50"
      >
        {isSubmitting ? "Subscribing…" : "Subscribe for updates"}
      </button>

      {status === "error" && (
        <p className="text-[12px] text-[#ef4444]">{message}</p>
      )}

      <p className="text-[11px] text-[#404040]">No spam. Product updates only.</p>
    </form>
  );
}
