import type { Metadata } from "next";
import Link from "next/link";
import { ViewTransition } from "react";
import { PullScroll } from "./pull-scroll";

export const metadata: Metadata = {
  title: "CampusPulse by Sygnetta",
  description: "Meetings, minutes, notices, and events for one college.",
  alternates: { canonical: "/" },
};

const day = [
  ["10:00", "Class hour", "Computer Science"],
  ["11:30", "Meeting", "Accepted"],
  ["16:00", "Club event", "Thursday"],
];

export default function Home() {
  return (
    <ViewTransition enter="campus-arrive" exit="campus-leave" default="none">
    <PullScroll>
    <main className="public-site">
      <a className="skip-link" href="#services">Skip to services</a>
      <section className="public-hero" aria-labelledby="campus-intro">
        <header className="public-header">
          <a className="public-brand" href="/">CampusPulse<small>BY SYGNETTA</small></a>
          <nav className="public-nav" aria-label="Site">
            <a href="/software/help/">Help & privacy</a>
            <a href="/software/install/">Install</a>
            <Link className="public-sign" href="/software/" transitionTypes={["nav-forward"]}>Sign in</Link>
          </nav>
        </header>
        <div className="public-hero-stage">
          <div className="public-hero-lead">
            <p className="public-kicker">The campus app</p>
            <h1 id="campus-intro">The campus day, in one place.</h1>
            <p>Meetings, minutes, notices, and events. Your college only.</p>
            <Link className="public-sign" href="/software/" transitionTypes={["nav-forward"]}>Sign in to your campus</Link>
          </div>
          <figure className="product-frame">
            <div className="product-stage">
              <div className="stage-rail" aria-hidden="true">
                <strong>CampusPulse</strong>
                <span data-on="true">Today</span>
                <span>Faculty</span>
                <span>Notices</span>
                <span>Events</span>
                <span>Requests</span>
                <span>Updates</span>
              </div>
              <div className="stage-main">
                <div className="stage-head">
                  <div>
                    <p>Today</p>
                    <h2>Friday</h2>
                  </div>
                  <span>Sample</span>
                </div>
                <ol>
                  {day.map(([time, title, detail]) => (
                    <li key={time}>
                      <time>{time}</time>
                      <strong>{title}</strong>
                      <em>{detail}</em>
                    </li>
                  ))}
                </ol>
                <div className="stage-note">
                  <p>Minutes</p>
                  <strong>Send the revised draft by Friday.</strong>
                  <span>Friday</span>
                  <span>Tuesday 4:00</span>
                </div>
              </div>
            </div>
            <figcaption>A sample day. Each college sees only its own people.</figcaption>
          </figure>
        </div>
      </section>

      <section className="public-chapters" id="services" aria-label="What you can do">
        <article>
          <div>
            <p>01</p>
            <h2>See who is free.</h2>
            <p>Available, busy, or away. Then ask for a time.</p>
          </div>
          <div className="chapter-panel" aria-hidden="true">
            <div><b>Prof. Meera Rao</b><i className="is-open">Available</i></div>
            <div><b>Prof. Arun Desai</b><i className="is-busy">Busy</i></div>
            <div><b>Prof. Sana Qureshi</b><i>Away</i></div>
          </div>
        </article>
        <article>
          <div>
            <p>02</p>
            <h2>Keep the minutes.</h2>
            <p>Meetings in any language are transcribed into English. The actions stay with the two of you, for 45 days.</p>
          </div>
          <div className="chapter-panel chapter-minutes" aria-hidden="true">
            <p>Transcript</p>
            <strong>Send the revised draft by Friday. Meet again Tuesday at 4.</strong>
            <span>Friday</span>
            <span>Tuesday 4:00</span>
          </div>
        </article>
        <article>
          <div>
            <p>03</p>
            <h2>The rest of the day.</h2>
            <p>Official notices, club events, and deadlines you keep for yourself.</p>
          </div>
          <div className="chapter-panel" aria-hidden="true">
            <div><b>Notice</b><i>Department · due Friday</i></div>
            <div><b>Club event</b><i>Thursday · 5:00</i></div>
            <div><b>Deadline</b><i>Only you</i></div>
          </div>
        </article>
      </section>

      <section className="public-close" aria-labelledby="start-heading">
        <div>
          <h2 id="start-heading">Your college provides the account.</h2>
          <p>Each college sees only its own people.</p>
          <Link className="public-sign" href="/software/" transitionTypes={["nav-forward"]}>Sign in</Link>
        </div>
      </section>
    </main>
    </PullScroll>
    </ViewTransition>
  );
}
