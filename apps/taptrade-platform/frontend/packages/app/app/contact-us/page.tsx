"use client";

import type React from "react";
import { useState } from "react";
import {
  buildSupportMailto,
  SUPPORT_EMAIL,
  type SupportRequest,
} from "./support-mailto";

type FormData = SupportRequest;

const STATUS_CLASS =
  "mb-6 rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] p-4 text-sm text-[var(--brand-dark)]";
const INPUT_CLASS =
  "box-border w-full rounded-md border border-[var(--border-1)] bg-[var(--surface-2)] px-3.5 py-3 text-sm text-[var(--t1)] transition-all duration-300 focus:border-[var(--accent)] focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-soft)]";
const TEXTAREA_CLASS =
  "box-border min-h-[140px] w-full resize-y rounded-md border border-[var(--border-1)] bg-[var(--surface-2)] px-3.5 py-3 font-[inherit] text-sm text-[var(--t1)] transition-all duration-300 focus:border-[var(--accent)] focus:outline-none focus:shadow-[0_0_0_3px_var(--accent-soft)]";

export default function ContactUsPage() {
  const [formData, setFormData] = useState<FormData>({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  // QA fix ISSUE-004 (2026-07-26): the form previously POSTed to
  // /api/v1/support/contact, an endpoint the gateway does not expose —
  // every signed-out submission died with a raw 401 and the message was
  // lost. Until a real support inbox endpoint ships, compose the message
  // in the visitor's own mail client instead: no backend dependency, no
  // silently dropped messages, and the address stays visible as a
  // fallback. Follow-up tracked in TODOS.md: gateway support endpoint.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    window.location.href = buildSupportMailto(formData);
    setSubmitted(true);
  };

  return (
    <div className="mx-auto max-w-[600px] px-5 py-10">
      <h1 className="mb-6 text-[28px] font-extrabold tracking-normal text-[var(--t1)]">
        Contact Us
      </h1>

      {submitted && (
        <div role="status" className={STATUS_CLASS}>
          Your email app should have opened with your message ready to send. If
          it didn't, email us directly at {SUPPORT_EMAIL}.
        </div>
      )}

      {error && (
        <div role="alert" className={STATUS_CLASS}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-5">
          <label
            htmlFor="name"
            className="mb-2 block text-sm font-semibold text-[var(--t2)]"
          >
            Full Name
          </label>
          <input
            id="name"
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            placeholder="Your name"
            className={INPUT_CLASS}
          />
        </div>

        <div className="mb-5">
          <label
            htmlFor="email"
            className="mb-2 block text-sm font-semibold text-[var(--t2)]"
          >
            Email Address
          </label>
          <input
            id="email"
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            placeholder="your@email.com"
            className={INPUT_CLASS}
          />
        </div>

        <div className="mb-5">
          <label
            htmlFor="subject"
            className="mb-2 block text-sm font-semibold text-[var(--t2)]"
          >
            Subject
          </label>
          <input
            id="subject"
            type="text"
            name="subject"
            value={formData.subject}
            onChange={handleChange}
            required
            placeholder="What is this about?"
            className={INPUT_CLASS}
          />
        </div>

        <div className="mb-5">
          <label
            htmlFor="message"
            className="mb-2 block text-sm font-semibold text-[var(--t2)]"
          >
            Message
          </label>
          <textarea
            id="message"
            name="message"
            value={formData.message}
            onChange={handleChange}
            required
            placeholder="Please tell us more..."
            className={TEXTAREA_CLASS}
          />
        </div>

        <button
          type="submit"
          className="w-full cursor-pointer rounded-md border-0 bg-[var(--accent)] px-5 py-3 text-[15px] font-semibold text-[var(--ticket-cta-text)] transition-[filter] duration-300 hover:brightness-[1.05] disabled:cursor-not-allowed disabled:opacity-70"
        >
          Send Message
        </button>
      </form>

      <div className="mt-10 rounded-lg border border-[var(--border-1)] bg-[var(--surface-2)] p-5">
        <div className="mb-3 text-base font-bold text-[var(--t1)]">
          Other Ways to Reach Us
        </div>
        <div className="mb-2 text-sm text-[var(--t2)]">
          <strong className="text-[var(--t1)]">Email:</strong>{" "}
          support@taptrade.com
        </div>
        <div className="mb-2 text-sm text-[var(--t2)]">
          <strong className="text-[var(--t1)]">Support Hours:</strong> Monday -
          Friday, 9 AM - 10 PM EST
        </div>
      </div>
    </div>
  );
}
