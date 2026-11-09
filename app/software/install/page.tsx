import { WorkspaceBrand } from "../workspace";
import { InstallPhoneApp } from "../pwa";
import styles from "../software.module.css";

export default function InstallPage() {
  return <main className={styles.helpPage}><WorkspaceBrand/><div className={styles.pageHead}><div><span className={styles.eyebrow}>CAMPUSPULSE ON YOUR PHONE</span><h1>Your campus, in your pocket.</h1><p>Install directly from this website on Android, iPhone or iPad.</p></div><a className={styles.secondary} href="/software/">Back to CampusPulse</a></div>
    <div className={styles.twoCards}><InstallPhoneApp/><section className={styles.card}><h2>Permissions, kept simple.</h2><p>Microphone access is requested only when you start a voice note. If you decline, you can continue with text and change the microphone setting later.</p><p>Optional phone alerts are requested only if you choose “Allow app alerts,” for meeting replies, official notices, and club events you follow. CampusPulse does not email those updates. Camera, location, contacts, photos, phone calls and Bluetooth are not requested.</p><h2>Online when it matters.</h2><p>Sign-in, current faculty availability, requests and private audio need an internet connection. The offline screen contains no campus records or voice notes.</p><p>Use your device’s screen lock and sign out on shared devices. The app and website use the same campus access rules.</p><a className={styles.link} href="/software/help/">Help & privacy →</a></section></div>
  </main>;
}
