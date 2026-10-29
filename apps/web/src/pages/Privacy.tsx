// The privacy page Google's sign-in setup links to. Anyone can read it without signing in.
import { Link } from '../lib/router.tsx';

export function PrivacyPage() {
  return (
    <div className="page privacy">
      <h1>Privacy</h1>
      <p className="muted">TSTV Rundowns · Texas Student Television</p>
      <p>
        TSTV Rundowns is the rundown, script and prompter website for Texas Student Television, a student organization. Only people
        TSTV invites can sign in.
      </p>
      <h2>What it stores</h2>
      <ul>
        <li>
          <strong>From your Google account, when you sign in:</strong> your name, email address and profile picture. Nothing else from
          your Google account is read.
        </li>
        <li>
          <strong>What you write here:</strong> shows, episodes, rundowns and scripts, and a record of who created and edited each part.
        </li>
        <li>
          <strong>A sign-in cookie</strong> that keeps you signed in for up to 30 days.
        </li>
      </ul>
      <h2>How it's used</h2>
      <p>
        Only to run TSTV's shows: to let invited people sign in, and to show who wrote and edited each rundown and script. It isn't sold,
        shared or used for advertising.
      </p>
      <h2>Where it's kept</h2>
      <p>On Cloudflare, which hosts the website. Video and graphics files are never uploaded here.</p>
      <h2>Removing your information</h2>
      <p>
        Ask TSTV's technical director, who can remove your account. Your name may stay on scripts you wrote, as part of the show's record.
      </p>
      <p>
        <Link to="/">Back to TSTV Rundowns</Link>
      </p>
    </div>
  );
}
