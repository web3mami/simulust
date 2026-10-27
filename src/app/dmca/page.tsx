import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/app-shell";

export const metadata: Metadata = { title: "DMCA Policy · Simulust" };

export default function DmcaPage() {
  return (
    <DocPage title="Copyright and DMCA" updated="October 26, 2026">
      <p>
        We respect copyright and respond to notices under the US Digital Millennium Copyright Act (17 U.S.C. § 512).
        Don&apos;t create characters or media that copy someone else&apos;s copyrighted characters or works.
      </p>

      <h2>Designated agent</h2>
      <p>
        [Agent name]
        <br />
        [Company legal name]
        <br />
        [Postal address]
        <br />
        [DMCA email] · [phone]
        <br />
        Registered with the US Copyright Office: [registration number].
      </p>

      <h2>Sending a notice</h2>
      <p>
        Send it to the agent above, or use the <Link href="/report">report form</Link> and choose &ldquo;Copyright
        infringement&rdquo;. Your notice must include:
      </p>
      <ol>
        <li>Your physical or electronic signature.</li>
        <li>The copyrighted work you say is infringed.</li>
        <li>
          The material you say infringes, and where it is: a page link, media id or character id.
        </li>
        <li>Your name, address, phone number and email.</li>
        <li>A statement that you believe in good faith the use isn&apos;t authorized by the owner, its agent or the law.</li>
        <li>
          A statement that the notice is accurate and, under penalty of perjury, that you are the owner or authorized
          to act for the owner.
        </li>
      </ol>
      <p>We remove or disable the material promptly and let the user who created it know.</p>

      <h2>Counter-notice</h2>
      <p>If you believe material was removed by mistake, send the agent a counter-notice with:</p>
      <ol>
        <li>Your physical or electronic signature.</li>
        <li>What was removed and where it was before.</li>
        <li>
          A statement under penalty of perjury that you believe in good faith it was removed by mistake or
          misidentification.
        </li>
        <li>
          Your name, address and phone number, and a statement that you consent to the jurisdiction of the federal
          district court for your address (or, outside the US, any district where we may be found) and will accept
          service from the person who sent the notice.
        </li>
      </ol>
      <p>
        We forward counter-notices to the original complainant and restore the material in 10 to 14 business days
        unless they tell us they&apos;ve filed a court action.
      </p>

      <h2>Repeat infringers</h2>
      <p>We close the accounts of users who repeatedly infringe.</p>

      <h2>False claims</h2>
      <p>
        Knowingly misrepresenting that material infringes, or that it was removed by mistake, can make you liable for
        damages under 17 U.S.C. § 512(f).
      </p>
    </DocPage>
  );
}
