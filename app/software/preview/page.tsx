import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in · CampusPulse by Sygnetta",
  description: "Sign in to use CampusPulse. Faculty availability is available after an active institution account signs in.",
  robots: { index: false, follow: false },
};

export default function Preview() {
  return (
    <main className="gate">
      <meta httpEquiv="refresh" content="0; url=/software/" />
      <div>
        <p className="eyebrow"><span /> CAMPUSPULSE · BY SYGNETTA</p>
        <h1>Sign in to continue.</h1>
        <p>This address no longer shows a faculty directory or status controls. Sign in to see your institution.</p>
        <a className="primary-button" href="/software/">Continue to sign in</a>
      </div>
    </main>
  );
}
