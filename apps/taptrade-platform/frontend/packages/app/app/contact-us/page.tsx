"use client";

import type React from "react";
import { useState } from "react";
import { Button, Input, Textarea } from "../components/ui";
import {
  buildSupportMailto,
  SUPPORT_EMAIL,
  type SupportRequest,
} from "./support-mailto";

type FormData = SupportRequest;

// Status banners follow the toast recipe (DESIGN.md §6): white surface,
// hairline, a 3px left edge in the system colour for the kind — never
// the ink/accent treatment for a success or error message.
const STATUS_BASE_CLASS =
  "mb-6 rounded-[var(--r-rh-md)] border border-[var(--border-1)] border-l-[3px] bg-[var(--surface-1)] p-4 text-sm text-[var(--t1)]";
const SUCCESS_STATUS_CLASS = `${STATUS_BASE_CLASS} border-l-[var(--success)]`;
const ERROR_STATUS_CLASS = `${STATUS_BASE_CLASS} border-l-[var(--danger)]`;
const LABEL_CLASS = "mb-2 block text-sm font-semibold text-[var(--t2)]";

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
    <div className="mx-auto max-w-[720px] px-4 py-12 md:py-16">
      <h1 className="type-poster m-0 mb-8 text-[clamp(28px,4vw,36px)] text-[var(--t1)]">
        Contact Us
      </h1>

      {submitted && (
        <div role="status" className={SUCCESS_STATUS_CLASS}>
          Your email app should have opened with your message ready to send. If
          it didn't, email us directly at {SUPPORT_EMAIL}.
        </div>
      )}

      {error && (
        <div role="alert" className={ERROR_STATUS_CLASS}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="mb-5">
          <label htmlFor="name" className={LABEL_CLASS}>
            Full Name
          </label>
          <Input
            id="name"
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            placeholder="Your name"
            className="w-full"
          />
        </div>

        <div className="mb-5">
          <label htmlFor="email" className={LABEL_CLASS}>
            Email Address
          </label>
          <Input
            id="email"
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            placeholder="your@email.com"
            className="w-full"
          />
        </div>

        <div className="mb-5">
          <label htmlFor="subject" className={LABEL_CLASS}>
            Subject
          </label>
          <Input
            id="subject"
            type="text"
            name="subject"
            value={formData.subject}
            onChange={handleChange}
            required
            placeholder="What is this about?"
            className="w-full"
          />
        </div>

        <div className="mb-5">
          <label htmlFor="message" className={LABEL_CLASS}>
            Message
          </label>
          <Textarea
            id="message"
            name="message"
            value={formData.message}
            onChange={handleChange}
            required
            placeholder="Please tell us more..."
            className="w-full min-h-[140px]"
          />
        </div>

        <Button type="submit" variant="primary" size="lg" className="w-full">
          Send Message
        </Button>
      </form>

      <div className="mt-10 rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-2)] p-5">
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
