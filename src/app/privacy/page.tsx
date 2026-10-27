import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/app-shell";

export const metadata: Metadata = { title: "Privacy Policy · Simulust" };

export default function PrivacyPage() {
  return (
    <DocPage title="Privacy Policy" updated="October 27, 2026">
      <p>
        [Company legal name], [registered address], runs Simulust and is the controller of your personal data. This
        policy explains what we collect, why, who we share it with, how long we keep it, and how to use your rights.
        Contact: [privacy email].
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Login identifiers.</strong> Your email address or social account ID, through our login provider, and
          an internal user ID.
        </li>
        <li>
          <strong>Wallet address.</strong> The Solana wallet you sign in or pay with, including an embedded wallet
          created for you.
        </li>
        <li>
          <strong>Chats.</strong> Your messages and the characters&apos; replies, plus summaries we make so characters
          can follow long conversations.
        </li>
        <li>
          <strong>Memories.</strong> Facts and preferences characters remember about you. You can see, edit and delete
          them on each character&apos;s memory page.
        </li>
        <li>
          <strong>Characters and profile.</strong> Characters you create and the profile details you add.
        </li>
        <li>
          <strong>Generated media.</strong> Photos, voice notes and videos made for you, and the prompts used to make
          them.
        </li>
        <li>
          <strong>Age-check outcome only.</strong> Whether you passed and when. Our verification provider collects your
          ID document and selfie directly. Its decision message can include details from your document; we use only
          the result and your birth date to confirm you&apos;re over 18, and we don&apos;t store your document, selfie,
          name or birth date.
        </li>
        <li>
          <strong>Payments.</strong> Orders, amounts, transaction signatures and the paying wallet address. Solana
          transactions are public by nature.
        </li>
        <li>
          <strong>Safety records.</strong> Automated moderation results (including short excerpts of blocked text) and
          reports you file.
        </li>
        <li>
          <strong>Technical data.</strong> IP address and country, used for security, rate limits and region blocking.
          We use only the cookies and local storage needed for login and the 18+ notice. No advertising trackers.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To run Simulust: generate replies, remember context, make media, and keep your credits and purchases.</li>
        <li>To keep people safe and meet legal duties: age checks, content moderation, report handling, sanctions screening, and reporting child sexual abuse material to NCMEC.</li>
        <li>To secure the service and prevent abuse.</li>
      </ul>
      <p>
        We don&apos;t sell or share your data for advertising, and we don&apos;t use your chats to train AI models.
      </p>

      <h2>Sensitive data and your consent</h2>
      <p>
        Conversations on an adult platform can reveal information about your sex life or sexual orientation. Under the
        GDPR (Article 9) that is special category data, and we process it only with your explicit consent, which you
        give when you turn on explicit content in <Link href="/settings">Settings</Link>. You can withdraw consent at
        any time by turning explicit content off or deleting your account; that doesn&apos;t affect processing that
        already happened. [Counsel: confirm whether consent must also be captured at signup for non-explicit chats.]
      </p>
      <p>
        Our other legal bases are: performing our contract with you (running the service), legal obligations (age
        verification, child-safety reporting, tax), and legitimate interests (security and fraud prevention).
      </p>

      <h2>Who processes data for us</h2>
      <ul>
        <li>Privy: login and embedded wallets.</li>
        <li>Veriff: age verification.</li>
        <li>[AI inference provider]: generating replies and memory embeddings, under no-training and minimal-retention terms.</li>
        <li>[GPU host]: generating images, voice notes and video on servers we control.</li>
        <li>Hive: automated image moderation.</li>
        <li>[Supabase]: database. [Cloudflare R2 / AWS S3]: media storage. [Vercel]: app hosting.</li>
        <li>Helius: Solana network access for confirming payments.</li>
      </ul>
      <p>
        Some processors are outside your country. Where data leaves the EEA or UK we rely on Standard Contractual
        Clauses or an adequacy decision. We disclose data to authorities only when the law requires it, and we report
        apparent child sexual abuse material to NCMEC as US law requires.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit and at rest, and access is limited to staff who need it. Chats are not end-to-end
        encrypted: our servers have to read your messages to generate replies.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Account, chats, memories, characters and media: until you delete them or your account.</li>
        <li>Deleted data leaves our live systems immediately and our backups within [30] days.</li>
        <li>Age-check outcome: as long as your account exists.</li>
        <li>
          Payment records (order, amount, transaction signature, paying wallet): kept after you delete your account,
          unlinked from it, for as long as tax law requires ([counsel: confirm the period]). The blockchain record
          of a payment is public and permanent; we can&apos;t remove it.
        </li>
        <li>Moderation records and reports: [1 year] after they&apos;re resolved.</li>
        <li>Content reported to NCMEC: preserved for one year as federal law requires, then deleted.</li>
        <li>Server logs: [30] days.</li>
      </ul>

      <h2>Your rights</h2>
      <ul>
        <li>
          <strong>Access and portability:</strong> download everything in one file from{" "}
          <Link href="/settings">Settings</Link>.
        </li>
        <li>
          <strong>Deletion:</strong> delete your account in Settings, or delete individual memories and characters at
          any time. Deleting your account cancels any checkout you haven&apos;t paid. We can&apos;t delete an account
          while some of its content may be evidence: while a report about its media or characters is open, while any
          of its media is held for a child-safety investigation, and for up to 90 days after a child-abuse report about
          its content that we haven&apos;t dismissed, or after we blocked a request it wrote for an image, video or
          character as sexualizing a minor, or our safety check flagged one of its photos as showing a minor, until
          we&apos;ve reviewed it. What you say in chat never holds up deletion. In those cases, email
          [privacy email] and we&apos;ll delete the account once the review is over, keeping only what the law
          requires.
        </li>
        <li><strong>Correction, restriction and objection:</strong> email [privacy email].</li>
        <li><strong>Withdraw consent:</strong> turn explicit content off, or delete your account.</li>
        <li>
          <strong>California residents:</strong> you can know, delete and correct your data and limit the use of
          sensitive personal information. We use it only to provide the service, and we don&apos;t sell or share it.
        </li>
        <li>
          <strong>Complaints:</strong> you can complain to your data protection authority. EU representative: [Article
          27 representative]. UK representative: [UK representative].
        </li>
      </ul>
      <p>We answer requests within one month, and don&apos;t treat you differently for using your rights.</p>

      <h2>Minors</h2>
      <p>
        Simulust is for adults only. If we learn an account belongs to someone under 18, we close it and delete its
        data, except what the law requires us to keep.
      </p>

      <h2>Changes</h2>
      <p>We&apos;ll tell you in the app or by email before material changes take effect.</p>
    </DocPage>
  );
}
