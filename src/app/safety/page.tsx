import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/app-shell";

export const metadata: Metadata = { title: "Safety · Simulust" };

export default function SafetyPage() {
  return (
    <DocPage title="Safety" updated="October 28, 2026">
      <h2>If you&apos;re struggling right now</h2>
      <p>
        If you&apos;re thinking about suicide or hurting yourself, please reach out to a person now. These services are
        free and confidential.
      </p>
      <ul>
        <li>
          <strong>Immediate danger:</strong> call your local emergency number (911 in the US and Canada, 999 in the UK,
          112 in the EU, 000 in Australia).
        </li>
        <li>
          <strong>United States:</strong> call or text <a href="tel:988">988</a> (Suicide &amp; Crisis Lifeline), or text
          HOME to 741741 (Crisis Text Line).
        </li>
        <li>
          <strong>Canada:</strong> call or text <a href="tel:988">988</a>.
        </li>
        <li>
          <strong>UK and Ireland:</strong> call Samaritans on <a href="tel:116123">116 123</a>.
        </li>
        <li>
          <strong>Australia:</strong> call Lifeline on <a href="tel:131114">13 11 14</a>.
        </li>
        <li>
          <strong>Anywhere else:</strong> find a helpline at{" "}
          <a href="https://findahelpline.com" target="_blank" rel="noreferrer">
            findahelpline.com
          </a>
          .
        </li>
      </ul>

      <h2>You&apos;re talking to an AI</h2>
      <p>
        Every character on Simulust is an AI. None is a real person, and no person is reading your chats and replying.
        We remind you of this when a conversation starts and every three hours during long ones. Characters can sound
        caring and remember a lot about you, but they don&apos;t have feelings, and they can get things wrong.
      </p>

      <h2>Characters are not therapists</h2>
      <p>
        Characters can&apos;t give medical, mental health, legal or financial advice, and they aren&apos;t a substitute
        for a professional or for people in your life. If you&apos;re going through something hard, please talk to
        someone who can help.
      </p>

      <h2>What happens if you mention self-harm</h2>
      <ul>
        <li>We check every message for signs that you might be in crisis.</li>
        <li>
          If we see them, the character steps out of the roleplay and shows you crisis resources like the ones above.
        </li>
        <li>
          We don&apos;t contact anyone or share your messages because of this. If you&apos;re in immediate danger,
          please call emergency services yourself.
        </li>
      </ul>

      <h2>Adults only</h2>
      <ul>
        <li>
          Everyone gives a date of birth before entering. Under 18, we don&apos;t let you in, and the device remembers.
        </li>
        <li>
          Creating an account asks for your date of birth again, and our server checks it. Under 18, no account is
          made.
        </li>
        <li>
          Simulust is uncensored for signed-in adults, with no setting to switch it on. Visitors who aren&apos;t signed
          in see only non-nude art, and nude images are never sent to them.
        </li>
        <li>
          If someone signed in says they&apos;re under 18 (on the age screen, in a chat, in a photo request or in Video
          Studio details), we pause explicit content on the account until a person on our team reviews it, and
          characters stop writing explicitly.
        </li>
        <li>
          Every character is a fictional adult, and every image and video is checked for apparent age before anyone
          sees it.
        </li>
      </ul>

      <h2>Using Simulust in a healthy way</h2>
      <ul>
        <li>Take breaks. Your characters and their memories will still be here.</li>
        <li>Prices for everything are published up front, and credits never expire, so there&apos;s no reason to rush.</li>
        <li>You decide whether characters send photos or voice notes on their own; it&apos;s off unless you turn it on.</li>
        <li>You can see, edit and delete what each character remembers about you.</li>
        <li>Don&apos;t share details that could identify you, like your address or workplace.</li>
      </ul>

      <h2>Reporting</h2>
      <p>
        If you see something that shouldn&apos;t be here, use the <Link href="/report">report form</Link>. Our rules are
        in the <Link href="/content-policy">content policy</Link>.
      </p>
    </DocPage>
  );
}
