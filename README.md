# VANTA (Vantasocials)

A modern, high-performance social growth and digital services storefront built with **Next.js (App Router)**, **Supabase (PostgreSQL, Auth, RLS)**, and automated SMM fulfillment providers.

---

## 🚀 Overview

VANTA provides a seamless experience for ordering social media engagement, followers, views, and digital services across major platforms (Instagram, TikTok, YouTube, X, Facebook, Telegram).

### Key Features

- **Storefront & Catalog**: Dynamic platform and service discovery with real-time currency pricing (GHS/USD).
- **Payment & Gateway Orchestration**:
  - Secure payments via **BundleUp Gateway** with HMAC-SHA256 request signing and Ed25519 asymmetric evidence verification.
  - Paystack integration for direct settlements and deposits.
  - Double-entry ledger **VANTA Wallet** system with atomic debit/credit operations.
- **Automated Multi-Provider Fulfillment**:
  - Direct integration with SMM providers (ReliableSMM, PanelFollows).
  - Rate-limit gates with cooldown locks and provider safety checks.
  - Automated worker cron (`/api/internal/fulfillment/cron`) for asynchronous dispatch, retry backoff, and state reconciliation.
- **Real-Time Customer Order Tracking**:
  - Live order timeline with verified fulfillment milestones (`Submitted`, `In Progress`, `Completed`).
  - Remaining units tracking (`remains` counter) pulled directly from provider status.
- **Hardened Admin Dashboard**:
  - Service catalog management, dynamic input schema builder, pricing engine, and currency FX management.
  - Keyset/cursor-based pagination and `pg_trgm` GIN search indexes.
  - Complete security hardening: durable rate limits, audit logging, and RLS policies.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js 15 (App Router)](https://nextjs.org/)
- **Language**: TypeScript / React 19
- **Database & Auth**: [Supabase](https://supabase.com/) (PostgreSQL with RLS, Stored Functions, and Triggers)
- **Analytics**: [PostHog](https://posthog.com/)
- **Styling**: Modern CSS modules & Vanilla CSS design system
- **Deployment**: Vercel

---

## 📁 Project Architecture

```
vanta/
├── app/                       # Next.js App Router
│   ├── (auth)/                # Login, Signup, Logout
│   ├── account/               # Customer Portal (Orders, Wallet, Settings)
│   ├── admin/                 # Hardened Admin Panel
│   ├── api/                   # REST API & Internal Webhooks / Crons
│   │   ├── admin/             # Admin mutation & catalog routes
│   │   ├── gateway/           # BundleUp Payment Gateway routes
│   │   ├── internal/          # Fulfillment cron & canary routes
│   │   └── payments/          # Payment verification & webhooks
│   ├── checkout/              # Checkout flow
│   ├── new-order/             # Direct ordering interface
│   └── page.tsx               # Homepage
├── components/                # Reusable UI Components
├── lib/                       # Core Business Logic & Libraries
│   ├── auth/                  # Supabase session guards & admin verification
│   ├── fulfillment/           # Provider adapters (ReliableSMM, PanelFollows)
│   ├── gateway/               # BundleUp HMAC & Ed25519 verification
│   ├── pricing/               # FX calculation & margin engine
│   └── supabase/              # Supabase server & admin clients
├── scripts/                   # Verification, migrations & test scripts
└── supabase/                  # Database migrations & SQL schema
```

---

## ⚙️ Environment Variables

Create a `.env.local` file in the root directory:

```env
# Supabase (Public & Service Role)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Site Configuration
NEXT_PUBLIC_SITE_URL=https://vantasocials.vercel.app

# Paystack
PAYSTACK_SECRET_KEY=sk_live_...

# Fulfillment Providers
PANELS_LIVE_FULFILLMENT_ENABLED=true
RELIABLESMM_API_KEY=your_reliablesmm_api_key
PANELFOLLOWS_API_KEY=your_panelfollows_api_key
RELIABLESMM_MIN_REQUEST_INTERVAL_MS=1000

# BundleUp Payment Gateway
VANTA_CHECKOUT_PAYMENT_PROVIDER=bundleup_gateway
VANTA_BUNDLEUP_GATEWAY_ENABLED=true
VANTA_BUNDLEUP_GATEWAY_BASE_URL=https://bundleupgh.shop
VANTA_BUNDLEUP_GATEWAY_ALLOWED_HOSTS=bundleupgh.shop
VANTA_BUNDLEUP_GATEWAY_CHECKOUT_HOSTS=checkout.paystack.com
VANTA_BUNDLEUP_GATEWAY_SHARED_SECRET=your_hmac_secret
VANTA_BUNDLEUP_GATEWAY_RETURN_URL=https://vantasocials.vercel.app/payments/bundleup/return
VANTA_BUNDLEUP_GATEWAY_EVIDENCE_PUBLIC_KEYS={"default":"your_ed25519_public_key_base64"}

# Internal Security & Cron
CRON_SECRET=your_secure_cron_secret
```

---

## 🏃 Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run database migrations**:
   Apply SQL scripts located in `supabase/migrations/` sequentially via your Supabase SQL editor or CLI.

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Run TypeScript check & tests**:
   ```bash
   npx tsc --noEmit
   node scripts/order-timeline-tests.mjs
   ```

5. **Build for production**:
   ```bash
   npm run build
   ```

---

## 🔒 Security & Invariants

- **Idempotent Operations**: All wallet debits, provider orders, and payment settlements enforce unique idempotency keys.
- **Fail-Closed Gateways**: Payment reconciliations reject expired, replayed, or mismatched nonce/amount requests.
- **RLS & Privilege Separation**: Customer tokens cannot write to provider logs or tamper with ledger balances.

---

## 📄 License

Proprietary — All rights reserved by VANTASOCIALS.
