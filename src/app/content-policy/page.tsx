import type { Metadata } from "next";
import Link from "next/link";
import { DocPage } from "@/components/app-shell";

export const metadata: Metadata = { title: "Content Policy · Simulust" };

export default function ContentPolicyPage() {
  return (
    <DocPage title="Content Policy" updated="October 28, 2026">
      <p>
        Simulust is for consenting adults exploring fiction with AI characters. Explicit content between fictional
        adults is allowed, within the rules below. These rules apply to everything: messages, character profiles,
        image and video prompts, and generated media.
      </p>

      <h2>Adults only</h2>
      <ul>
        <li>
          Every user must be 18 or older. Everyone gives a date of birth before entering and again when creating an
          account, and explicit content is only for signed-in accounts that have confirmed they&apos;re adults. Anyone
          who says they&apos;re under 18 has explicit content paused while we review the account.
        </li>
        <li>
          Every character must be 18 or older, and must look, talk and act like an adult. That includes anime and other
          stylized characters.
        </li>
      </ul>

      <h2>Never allowed</h2>
      <h3>Minors, or anyone who seems like one</h3>
      <ul>
        <li>Any sexual or romantic content involving someone under 18, real or fictional.</li>
        <li>
          Minor-coded content: childlike bodies, faces, voices or behaviour; school settings or uniforms in a sexual
          context; &ldquo;young-looking&rdquo; or &ldquo;barely legal&rdquo; framing; age-play. This applies to anime
          and drawn styles too.
        </li>
        <li>
          Saying a character is &ldquo;really 18&rdquo; or &ldquo;a 1,000-year-old spirit&rdquo; doesn&apos;t change
          anything. We judge how a character is presented.
        </li>
      </ul>
      <h3>Real people</h3>
      <ul>
        <li>
          Sexual or intimate content about real, identifiable people: celebrities, public figures, streamers and
          creators, or anyone you know.
        </li>
        <li>Deepfakes, face swaps, &ldquo;undressing&rdquo; photos, or using a real person&apos;s photo as a reference.</li>
        <li>Sharing intimate images of anyone without their consent.</li>
      </ul>
      <h3>Other prohibited content</h3>
      <ul>
        <li>Bestiality, necrophilia, or sexual content involving death or serious injury.</li>
        <li>Encouraging suicide, self-harm or eating disorders.</li>
        <li>Content promoting terrorism, trafficking or other serious crime, or content that&apos;s illegal where you live.</li>
        <li>Using Simulust to harass, threaten or expose anyone, including posting someone&apos;s personal information.</li>
      </ul>

      <h2>What is allowed</h2>
      <p>
        Consensual fantasies between fictional adults, including nude art, explicit chat and explicit videos you make
        in the Video Studio. Simulust is uncensored for every signed-in adult; there&apos;s no explicit setting to turn
        on. Every image and video shows one fictional adult character; you can&apos;t upload photos or add real people.
        You set the pace and the boundaries; characters follow your lead, and you can tell a character to stop or
        change direction at any time.
      </p>

      <h2>How we enforce this</h2>
      <ul>
        <li>
          Every message, character and prompt is screened automatically, and every generated image and video frame is
          checked before you see it, including for apparent age and resemblance to real people.
        </li>
        <li>
          Blocked requests don&apos;t cost you credits: anything charged for blocked or failed media is refunded.
        </li>
        <li>People review flagged content and every report.</li>
        <li>
          Depending on severity we block the content, remove characters, warn, suspend, or permanently ban the account.
        </li>
        <li>
          Anything involving the sexual abuse or exploitation of minors gets an immediate permanent ban. We report it
          to the National Center for Missing &amp; Exploited Children (NCMEC), preserve it as the law requires, and
          cooperate with law enforcement.
        </li>
      </ul>

      <h2>Reports and appeals</h2>
      <p>
        Report anything that breaks these rules through the <Link href="/report">report form</Link>; no account is
        needed. Non-consensual intimate images are removed within 48 hours of a valid request under the TAKE IT DOWN
        Act. If you think we got a decision about your account wrong, email [appeals email] within 30 days and a
        different person will review it.
      </p>
    </DocPage>
  );
}
