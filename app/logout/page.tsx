import Link from "next/link";
import { LogoutButton } from "../../components/auth/LogoutButton";

export default function LogoutPage() { return <main className="service-page"><Link href="/">VANTA</Link><p className="section-kicker">ACCOUNT</p><h1>Log out</h1><p>End this browser session.</p><LogoutButton /></main>; }
