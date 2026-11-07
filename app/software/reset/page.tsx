import { PasswordResetRequest } from "../password-reset";
import { WorkspaceBrand } from "../workspace";
import styles from "../software.module.css";

export default function ResetPage() {
  return <main className={styles.loginPage}><div className={styles.loginCard}><WorkspaceBrand/><PasswordResetRequest/></div></main>;
}
