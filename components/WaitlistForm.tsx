"use client";

import { FormEvent, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type WaitlistResponse = {
  ok: boolean;
  status?: "created" | "existing";
  message?: string;
  error?: string;
};

const roleOptions = [
  "Estimator",
  "Contractor",
  "Consultant",
  "Developer",
  "Architect",
  "Project Manager",
  "Quantity Surveyor",
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          role,
          company,
          source: "landing_page",
        }),
      });

      const result = (await response.json()) as WaitlistResponse;

      if (!response.ok || !result.ok) {
        setStatus("error");
        setMessage(result.error ?? "We couldn't save your details. Please try again.");
        return;
      }

      setStatus("success");
      setMessage(
        result.message ?? "You're on the list. We'll send updates to your inbox.",
      );

      if (result.status === "created") {
        setEmail("");
        setCompany("");
        setRole(roleOptions[0]);
      }
    } catch {
      setStatus("error");
      setMessage("We couldn't save your details. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:p-6"
    >
      <div className="mb-5 space-y-2">
        <p className="text-sm font-semibold text-white">Join the launch waitlist</p>
        <p className="text-sm leading-relaxed text-gray-400">
          Get launch updates, early access news, and product milestones in one place.
        </p>
      </div>

      <div className="space-y-4">
        <label className="block space-y-2">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
            Work email
          </span>
          <Input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            className="h-11 border-white/10 bg-black/30 px-3 text-sm text-white placeholder:text-gray-500"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Role
            </span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-white outline-none transition-colors focus-visible:border-amber-400"
            >
              {roleOptions.map((option) => (
                <option key={option} value={option} className="bg-[#0a0a0a] text-white">
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">
              Company
            </span>
            <Input
              type="text"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
              placeholder="Your firm or team"
              className="h-11 border-white/10 bg-black/30 px-3 text-sm text-white placeholder:text-gray-500"
            />
          </label>
        </div>
      </div>

      <Button
        type="submit"
        size="lg"
        disabled={isSubmitting}
        className="mt-5 h-11 w-full rounded-xl bg-amber-400 text-sm font-bold text-black hover:bg-amber-300"
      >
        {isSubmitting ? "Joining..." : "Join the waitlist"}
      </Button>

      <p className="mt-3 text-xs leading-relaxed text-gray-500">
        By joining, you agree to receive launch updates and early access news from BOQ
        Generator.
      </p>

      {message ? (
        <p
          className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
            status === "success"
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/20 bg-red-500/10 text-red-200"
          }`}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
