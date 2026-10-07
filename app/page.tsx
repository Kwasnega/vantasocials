"use client";

import { useState } from "react";
import { ServicesShowcase } from "../components/home/ServicesShowcase";

type PlatformId = "instagram" | "tiktok" | "youtube" | "facebook" | "x" | "telegram";
type Service = { name: string; targetType: "username" | "url" | "channel" | "page" };
type Platform = { id: PlatformId; name: string; icon: string; services: Service[] };

const platforms: Platform[] = [
  { id: "instagram", name: "Instagram", icon: "IG", services: [{ name: "Likes", targetType: "url" }, { name: "Views", targetType: "url" }, { name: "Followers", targetType: "username" }, { name: "Comments", targetType: "url" }, { name: "Saves", targetType: "url" }] },
  { id: "tiktok", name: "TikTok", icon: "TT", services: [{ name: "Likes", targetType: "url" }, { name: "Views", targetType: "url" }, { name: "Followers", targetType: "username" }, { name: "Shares", targetType: "url" }, { name: "Comments", targetType: "url" }] },
  { id: "youtube", name: "YouTube", icon: "YT", services: [{ name: "Subscribers", targetType: "channel" }, { name: "Views", targetType: "url" }, { name: "Likes", targetType: "url" }, { name: "Comments", targetType: "url" }] },
  { id: "facebook", name: "Facebook", icon: "f", services: [{ name: "Page followers", targetType: "page" }, { name: "Page likes", targetType: "page" }, { name: "Post likes", targetType: "url" }, { name: "Reactions", targetType: "url" }, { name: "Video views", targetType: "url" }] },
  { id: "x", name: "X", icon: "X", services: [{ name: "Followers", targetType: "username" }, { name: "Likes", targetType: "url" }, { name: "Reposts", targetType: "url" }, { name: "Post views", targetType: "url" }] },
  { id: "telegram", name: "Telegram", icon: "TG", services: [{ name: "Channel members", targetType: "channel" }, { name: "Post views", targetType: "url" }, { name: "Reactions", targetType: "url" }] },
];

const ArrowUpRight = () => <span aria-hidden="true" className="arrow">↗</span>;

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [platform, setPlatform] = useState("Instagram");
  const [service, setService] = useState("Followers");
  const platformData = platforms.find((item) => item.name === platform) ?? platforms[0];
  const services = platformData.services.map((item) => item.name);

  return (
    <>
    <main className="hero">
      <div className="grain" aria-hidden="true" />
      <nav className="nav" aria-label="Primary navigation">
        <a className="brand" href="#top" aria-label="VANTA home"><span className="brand-mark">V</span>VANTA</a>
        <div className="nav-links">
          <div className="nav-dropdown"><a href="#services">Instagram services <span className="chevron">⌄</span></a><div className="dropdown-panel"><a href="#services"><b>◎</b> Buy followers</a><a href="#services"><b>♥</b> Buy likes</a><a href="#services"><b>◉</b> Buy views</a><a href="#services"><b>⟳</b> Auto-likes</a><a href="#services"><b>⟳</b> Auto-views</a></div></div>
          <div className="nav-dropdown"><a href="#services">TikTok services <span className="chevron">⌄</span></a><div className="dropdown-panel"><a href="#services"><b>♪</b> Buy followers</a><a href="#services"><b>♥</b> Buy likes</a><a href="#services"><b>◉</b> Buy views</a><a href="#services"><b>⟳</b> Auto-likes</a><a href="#services"><b>⟳</b> Auto-views</a></div></div>
        </div>
        <div className="nav-actions">
          <a className="login" href="/login">Log in</a>
          <a className="signup" href="/signup">Start growing</a>
          <button className="menu" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen}>
            <i /><i />
          </button>
        </div>
      </nav>

      {menuOpen && <div className="site-menu" role="dialog" aria-modal="true" aria-label="Site menu"><button className="menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">Close <b aria-hidden="true">×</b></button><div className="menu-services"><div className="menu-service"><h2>◎ Instagram<br />services</h2><a href="#services" onClick={() => setMenuOpen(false)}>◎ &nbsp; Buy followers</a><a href="#services" onClick={() => setMenuOpen(false)}>♥ &nbsp; Buy likes</a><a href="#services" onClick={() => setMenuOpen(false)}>◉ &nbsp; Buy views</a><a href="#services" onClick={() => setMenuOpen(false)}>⟳ &nbsp; Auto-likes</a><a href="#services" onClick={() => setMenuOpen(false)}>⟳ &nbsp; Auto-views</a></div><div className="menu-service"><h2>♪ TikTok<br />services</h2><a href="#services" onClick={() => setMenuOpen(false)}>♪ &nbsp; Buy followers</a><a href="#services" onClick={() => setMenuOpen(false)}>♥ &nbsp; Buy likes</a><a href="#services" onClick={() => setMenuOpen(false)}>◉ &nbsp; Buy views</a><a href="#services" onClick={() => setMenuOpen(false)}>⟳ &nbsp; Auto-likes</a><a href="#services" onClick={() => setMenuOpen(false)}>⟳ &nbsp; Auto-views</a></div></div><nav className="menu-nav" aria-label="Menu links"><a href="#top" onClick={() => setMenuOpen(false)}>Home</a><a href="#how" onClick={() => setMenuOpen(false)}>How it works</a><a href="#services" onClick={() => setMenuOpen(false)}>Services</a><a href="#guarantees-heading" onClick={() => setMenuOpen(false)}>Guarantees</a><a href="mailto:vantasocials62@gmail.com">Support</a></nav></div>}

      <section className="hero-copy" id="top">
        <p className="eyebrow">SOCIAL GROWTH, SIMPLIFIED</p>
        <h1><span>Grow your presence.</span><span>Across every platform.</span></h1>
        <p className="intro">Premium social growth, without the guesswork. Choose your platform, select a service, and get moving — fast.</p>
        <div className="hero-buttons">
          <a className="button button-solid" href="#platforms">Explore platforms <ArrowUpRight /></a>
          <a className="button button-outline" href="#how">How it works <ArrowUpRight /></a>
        </div>
      </section>

      <div className="scene" aria-hidden="true">
        <div className="float float-one">+10,000</div>
        <div className="float float-two">✦</div>
        <div className="float float-three">+</div>
        <div className="temporary-photo" />
        <div className="orb orb-left" /><div className="orb orb-mid" /><div className="orb orb-right" />
        <div className="platform-strip"><span>IG</span><span>TT</span><span>YT</span><span>f</span><span>𝕏</span><span>✈</span></div>
      </div>

      <aside className="rating-card"><div className="stars">★★★★★ <b>4.9/5.0</b></div><p>Selected for a better kind<br />of social growth.</p></aside>
      <aside className="benefits"><p>◉ &nbsp; No password required</p><p>ϟ &nbsp; Fast, dependable delivery</p><p>▣ &nbsp; Secure checkout</p></aside>
      <a className="support" href="mailto:vantasocials62@gmail.com" aria-label="Contact VANTA">●</a>
    </main>

    <section className="how-it-works" id="how" aria-labelledby="how-heading">
      <div className="how-intro">
        <p className="section-kicker">THE VANTA WAY</p>
        <h2 id="how-heading">How it works<br />in four easy steps</h2>
        <p>Choose a platform and service, set your target and quantity, then complete your order in minutes.</p>
        <a className="how-cta" href="#platforms">Explore services <ArrowUpRight /></a>
      </div>
      <div className="steps-grid">
        <article className="step-card"><span className="step-tag lime">Step 01</span><h3>Choose your platform</h3><p>Start with Instagram, TikTok, YouTube, Facebook, X, or Telegram.</p></article>
        <article className="step-card"><span className="step-tag yellow">Step 02</span><h3>Pick a service<br />you need</h3><p>Browse followers, likes, views and the services available for your platform.</p></article>
        <article className="step-card"><span className="step-tag blue">Step 03</span><h3>Configure your order</h3><p>Enter the right target, select a quantity, and see your total before checkout.</p></article>
        <article className="step-card"><span className="step-tag pink">Step 04</span><div className="guarantee">Secure checkout <b>i</b></div><h3>Pay &amp; start<br />growing</h3><p>Complete payment securely and we’ll take care of fulfillment.</p></article>
      </div>
    </section>

    <ServicesShowcase />
    <section className="services-showcase legacy-services-showcase" id="legacy-services" aria-hidden="true">
      <header className="services-heading">
        <p className="section-kicker">BUILT FOR MOMENTUM</p>
        <h2 id="services-heading">Grow faster<br />with our services</h2>
        <p>Choose the platform and growth service that fits your next move. Clear pricing, simple setup, and no passwords.</p>
      </header>

      <div className="platform-switch" role="tablist" aria-label="Platform services">
        {(["Instagram", "TikTok"] as const).map((item) => <button key={item} className={platform === item ? "active" : ""} onClick={() => { setPlatform(item); setService("Followers"); }} role="tab" aria-selected={platform === item}><span>{item === "Instagram" ? "◎" : "♪"}</span>{item} services</button>)}
      </div>

      <div className="platform-switch platform-switch-more" role="tablist" aria-label="More platform services">
        {platforms.slice(2).map((item) => <button key={item.id} className={platform === item.name ? "active" : ""} onClick={() => { setPlatform(item.name); setService(item.services[0].name); }} role="tab" aria-selected={platform === item.name}><span>{item.icon}</span>{item.name} services</button>)}
      </div>

      <div className="featured-service">
        <div className="service-tabs" role="tablist" aria-label="Service categories">
          {services.map((item) => <button key={item} className={service === item ? "active" : ""} onClick={() => setService(item)} role="tab" aria-selected={service === item}>{item}</button>)}
        </div>
        <div className="featured-content">
          <div className="featured-copy">
            <p className="service-label">{platform} / {service}</p>
            <h3>{platform} {service}</h3>
            <p>Choose a quantity, add your public {service === "Followers" ? "username" : "post or profile link"}, and we’ll handle the rest with precision.</p>
            <div className="service-action"><a href="#start">Start growing <ArrowUpRight /></a><span>Simple, secure checkout</span></div>
          </div>
          <div className="service-art" aria-hidden="true"><div className="art-halo" /><img src="/hero.png" alt="" /></div>
        </div>
      </div>
    </section>

    <section className="delivery-options" aria-labelledby="delivery-heading">
      <header className="delivery-heading">
        <p className="section-kicker">FLEXIBLE BY DESIGN</p>
        <h2 id="delivery-heading">One-time growth or<br />automatic delivery?</h2>
        <p>Boost a target today, or keep new content moving with a delivery rhythm that suits you.</p>
      </header>

      <article className="delivery-card one-time">
        <div><h3>Use one-time boosts for exact targets.</h3><p>Choose this for a post, video, or profile that already exists and needs a focused push right now.</p></div>
        <div className="delivery-actions"><ul><li>Launches and announcements</li><li>Underperforming posts</li><li>Pinned content</li><li>Trying VANTA for the first time</li></ul><a href="#start">Create an order <ArrowUpRight /></a></div>
      </article>

      <article className="delivery-card automatic">
        <div className="automatic-intro"><h3>Use automatic delivery when the pattern repeats.</h3><p>Set your amount once. Eligible new uploads can receive the chosen support as they go live.</p><ul><li>New uploads detected automatically</li><li>Choose a delivery amount</li><li>Clear controls before checkout</li></ul></div>
        <div className="auto-options">
          <div className="auto-platform"><h4>◎ &nbsp; Instagram</h4><p>For public posts and Reels that need a consistent initial push.</p><div><span>Auto-likes</span><b>Set per post</b></div><div><span>Auto-views</span><b>Set per post</b></div><section><a href="#start">Auto-likes <ArrowUpRight /></a><a href="#start">Auto-views <ArrowUpRight /></a></section></div>
          <div className="auto-platform"><h4>♪ &nbsp; TikTok</h4><p>For new videos you want to support the moment they become available.</p><div><span>Auto-likes</span><b>Set per video</b></div><div><span>Auto-views</span><b>Set per video</b></div><section><a href="#start">Auto-likes <ArrowUpRight /></a><a href="#start">Auto-views <ArrowUpRight /></a></section></div>
        </div>
      </article>
    </section>

    <section className="order-flow" aria-labelledby="flow-heading">
      <header className="flow-heading">
        <p className="section-kicker">ORDER FLOW</p>
        <h2 id="flow-heading">How we deliver<br />your order</h2>
        <p>From the moment you place an order to fulfillment, here’s how VANTA keeps the process clear and dependable.</p>
      </header>
      <div className="flow-diagram">
        <div className="flow-hub" aria-hidden="true"><span>V</span></div>
        <div className="flow-rays" aria-hidden="true" />
        <div className="flow-cards">
          <article className="flow-card"><div className="flow-number orange">01</div><h3>Your order is created</h3><p>Choose a service, add the correct target, and review your order before moving to payment.</p></article>
          <article className="flow-card"><div className="flow-number magenta">02</div><h3>Payment is verified</h3><p>Once payment is confirmed, VANTA securely prepares the order for fulfillment.</p></article>
          <article className="flow-card"><div className="flow-number cyan">03</div><h3>Fulfillment begins</h3><p>Your selected service begins according to its stated delivery terms. We’re here if you need help.</p></article>
        </div>
      </div>
    </section>

    <section className="guarantees" aria-labelledby="guarantees-heading">
      <header><p className="section-kicker">BUY WITH CONFIDENCE</p><h2 id="guarantees-heading">Your guarantees,<br />every order</h2><p>We put the important promises up front, so you can order with more clarity and confidence.</p></header>
      <div className="guarantee-list">
        <article><span className="guarantee-index pink-index">01</span><div><h3>Money-back guarantee</h3><p>If a qualifying order cannot be delivered as promised, VANTA will make it right under our refund policy.</p></div></article>
        <article><span className="guarantee-index orange-index">02</span><div><h3>Delivery support</h3><p>Need help with an eligible order? Our support process is designed to give you a clear next step.</p></div></article>
        <article><span className="guarantee-index yellow-index">03</span><div><h3>Secure checkout</h3><p>Payments are handled through our payment provider. Your card details are never stored in VANTA’s frontend.</p></div></article>
        <article><span className="guarantee-index violet-index">04</span><div><h3>Privacy first</h3><p>We only request the target information needed to deliver your order—never your social account password.</p></div></article>
      </div>
    </section>

    <section className="momentum" aria-labelledby="momentum-heading">
      <header><p className="section-kicker">THE VANTA DIFFERENCE</p><h2 id="momentum-heading">Stop waiting.<br />Start moving.</h2><p>Strong content deserves a stronger start. VANTA makes it simple to choose the support that helps your next post, profile, or video find momentum.</p><p>Set the target, select the quantity, and move forward with a clear order flow—without handing over your password.</p><h3>Three ways VANTA keeps you moving</h3></header>
      <div className="benefit-grid">
        <article><div className="benefit-art magenta-art"><img src="https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&amp;fit=crop&amp;w=1200&amp;q=85" alt="" /></div><h3>Boost your visibility</h3><p>Give the content you care about a purposeful initial push with a service built for the platform.</p></article>
        <article><div className="benefit-art violet-art"><img src="https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&amp;fit=crop&amp;w=1200&amp;q=85" alt="" /></div><h3>Build confidence</h3><p>A stronger starting point helps your profile and content make a clearer first impression.</p></article>
        <article><div className="benefit-art blue-art"><img src="https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&amp;fit=crop&amp;w=1200&amp;q=85" alt="" /></div><h3>Keep it simple</h3><p>Choose a service, enter your target, and check out with a focused, uncomplicated experience.</p></article>
      </div>
    </section>

    <footer className="site-footer">
      <div className="footer-mark" aria-hidden="true">VANTA</div>
      <div className="footer-main">
        <div className="footer-intro"><a className="footer-brand" href="#top"><span>V</span> VANTA</a><h2>Grow with clarity.<br />Move with purpose.</h2><a className="footer-cta" href="#start">Start growing <ArrowUpRight /></a><p>© {new Date().getFullYear()} VANTA. All rights reserved.<br /><a href="mailto:vantasocials62@gmail.com">vantasocials62@gmail.com</a></p></div>
        <nav className="footer-links" aria-label="Footer navigation">
          <div><h3>Platforms</h3><a href="#services">Instagram</a><a href="#services">TikTok</a><a href="#services">YouTube</a><a href="#services">Facebook</a><a href="#services">X</a><a href="#services">Telegram</a></div>
          <div><h3>Services</h3><a href="#services">Followers</a><a href="#services">Likes</a><a href="#services">Views</a><a href="#services">Comments</a><a href="#services">Engagement</a></div>
          <div><h3>VANTA</h3><a href="#how">How it works</a><a href="#delivery-heading">Delivery options</a><a href="#guarantees-heading">Guarantees</a><a href="mailto:vantasocials62@gmail.com">Support</a></div>
          <div><h3>Legal</h3><a href="#">Terms of service</a><a href="#">Privacy policy</a><a href="#">Refund policy</a></div>
        </nav>
      </div>
    </footer>

    </>
  );
}
