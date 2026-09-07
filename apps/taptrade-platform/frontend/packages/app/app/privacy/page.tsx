"use client";

export default function PrivacyPage() {
  return (
    <div className="relative mx-auto max-w-[720px] rounded-[var(--r-rh-lg)] border border-[var(--border-1)] bg-[var(--surface-1)] px-9 pb-8 pt-9">
      <h1 className="mb-1.5 text-[26px] font-extrabold tracking-normal text-[var(--t1)]">
        Privacy Policy
      </h1>
      <p className="mb-7 font-mono text-xs tracking-[0.04em] text-[var(--t3)]">
        Last updated: May 2026 · Controller: DORA Research, Inc.
      </p>

      <section className="mb-6">
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          This Privacy Policy explains how DORA Research, Inc. ("DORA Research",
          "we", "us"), operator of Tap Trade, collects, uses, and protects
          personal information when you use the Platform. DORA Research, Inc. is
          the data controller for that information.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-base font-bold tracking-normal text-[var(--t1)]">
          1. Information We Collect
        </h2>
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          We collect information you provide when creating an account, such as
          username and email, plus information needed for eligibility, safety,
          verification, or compliance. We also collect usage data including
          prediction history, device information, and IP address.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-base font-bold tracking-normal text-[var(--t1)]">
          2. How We Use Your Information
        </h2>
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          Your data is used to operate your account, maintain the point ledger,
          support responsible-play controls, provide customer support, improve
          our services, and communicate important account updates.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-base font-bold tracking-normal text-[var(--t1)]">
          3. Data Sharing
        </h2>
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          We do not sell your personal information. We may share data with
          eligibility and safety providers, regulatory authorities as required
          by law, and service providers who assist in operating the platform.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-base font-bold tracking-normal text-[var(--t1)]">
          4. Data Security
        </h2>
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          We use industry-standard encryption and security measures to protect
          your data. Point-ledger and account activity records are protected in
          transit and at rest. Access to personal data is restricted to
          authorized personnel only.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-base font-bold tracking-normal text-[var(--t1)]">
          5. Cookies &amp; Tracking
        </h2>
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          We use essential cookies for authentication and session management.
          Analytics cookies help us understand how the platform is used. You can
          manage cookie preferences in your browser settings.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-base font-bold tracking-normal text-[var(--t1)]">
          6. Your Rights
        </h2>
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          Depending on your jurisdiction, you may have the right to access,
          correct, or delete your personal data, object to processing, and
          request data portability. To exercise these rights, contact our
          privacy team.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-base font-bold tracking-normal text-[var(--t1)]">
          7. Data Retention
        </h2>
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          We retain account data for the duration of your account and for a
          period thereafter as required by regulatory obligations. Point-ledger
          records are retained for audit and integrity purposes.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-base font-bold tracking-normal text-[var(--t1)]">
          8. Legal Bases for Processing
        </h2>
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          Where applicable law requires a legal basis, we process personal data
          to perform our contract with you, to comply with legal and regulatory
          obligations, and for our legitimate interests in securing, improving,
          and operating the Platform, balanced against your rights.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-base font-bold tracking-normal text-[var(--t1)]">
          9. International Data Transfers
        </h2>
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          We and our service providers may process personal data in countries
          other than the one in which you reside. Where data is transferred
          across borders, we apply appropriate safeguards consistent with
          applicable data-protection law.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-base font-bold tracking-normal text-[var(--t1)]">
          10. Children
        </h2>
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          The Platform is not directed to, and may not be used by, anyone below
          the minimum age for participation in event-contract markets in their
          jurisdiction. We do not knowingly collect data from such individuals
          and will delete it if identified.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-base font-bold tracking-normal text-[var(--t1)]">
          11. Changes to This Policy
        </h2>
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          We may update this Policy from time to time. Material changes will be
          reflected by updating the "Last updated" date above. Continued use of
          the Platform after an update constitutes acceptance of the revised
          Policy.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2.5 text-base font-bold tracking-normal text-[var(--t1)]">
          12. Contact
        </h2>
        <p className="text-sm leading-[1.7] text-[var(--t2)]">
          Privacy inquiries can be sent to{" "}
          <a
            href="mailto:privacy@taptrade.com"
            className="font-semibold text-[var(--accent)] no-underline hover:brightness-110 hover:underline"
          >
            privacy@taptrade.com
          </a>
          , DORA Research, Inc.
        </p>
      </section>
    </div>
  );
}
