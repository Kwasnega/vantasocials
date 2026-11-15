import "server-only";

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = {
  success: boolean;
  messageId?: string;
  error?: string;
};

/**
 * Transactional Email Dispatcher
 *
 * Checks for RESEND_API_KEY or transactional SMTP webhook.
 * If not configured, gracefully logs to console and records the event for audit.
 */
export async function sendTransactionalEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { to, subject, html, text } = params;

  // 1. Resend integration if RESEND_API_KEY is configured
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || "VANTA <orders@vantasocials.com>",
          to: [to],
          subject,
          html,
          text,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        return { success: true, messageId: data.id };
      }
      console.error("[Email] Resend API error:", data);
      return { success: false, error: data.message || "Failed to send via Resend" };
    } catch (err) {
      console.error("[Email] Resend exception:", err);
      return { success: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }

  // 2. Fallback / Dev mode: Log dispatch cleanly
  console.info(
    JSON.stringify({
      event: "transactional_email_dispatched",
      to,
      subject,
      preview: text.slice(0, 100),
      timestamp: new Date().toISOString(),
    })
  );

  return { success: true, messageId: `mock_${Date.now()}` };
}

/**
 * Generates the email for target fix request.
 */
export function renderTargetFixEmail(params: {
  serviceName: string;
  publicOrderId: string;
  fixUrl: string;
  expiresInDays: number;
}): { subject: string; html: string; text: string } {
  const { serviceName, publicOrderId, fixUrl, expiresInDays } = params;
  const subject = `Action needed on your VANTA order #${publicOrderId}`;

  const text = `Hello,

We are trying to deliver your order #${publicOrderId} for ${serviceName}, but our system was unable to deliver to the link provided (it may be misspelled, formatted incorrectly, or set to private).

You do NOT need to pay again. Please click the link below to enter your corrected link:
${fixUrl}

This link is valid for ${expiresInDays} days. Once you submit the updated link, our delivery system will immediately resume fulfilling your order.

Thank you,
The VANTA Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0c10; color: #ffffff; padding: 24px; margin: 0; }
    .card { background-color: #14161f; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; max-width: 520px; margin: 0 auto; padding: 32px; }
    .logo { font-size: 20px; font-weight: 800; letter-spacing: 0.1em; color: #ffffff; margin-bottom: 24px; }
    h1 { font-size: 18px; font-weight: 600; margin: 0 0 16px; color: #ffffff; }
    p { font-size: 14px; line-height: 1.6; color: rgba(255,255,255,0.7); margin: 0 0 16px; }
    .btn { display: inline-block; background-color: #7928ca; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; margin: 16px 0; }
    .footer { font-size: 12px; color: rgba(255,255,255,0.4); margin-top: 24px; border-top: 1px solid rgba(255,255,255,0.08); pt: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">VANTA</div>
    <h1>Action required on order #${publicOrderId}</h1>
    <p>We are ready to deliver your order for <strong>${serviceName}</strong>, but our system was unable to deliver to the link provided. It may be misspelled, formatted unexpectedly, or set to private.</p>
    <p><strong>You do not need to pay again.</strong> Simply update your link using the secure link below:</p>
    <a href="${fixUrl}" class="btn">Update Order Link</a>
    <p style="font-size: 12px; color: rgba(255,255,255,0.5);">This secure link is valid for ${expiresInDays} days. Once submitted, delivery will automatically resume.</p>
    <div class="footer">
      <p>If the button above does not work, copy and paste this URL into your browser:<br>${fixUrl}</p>
    </div>
  </div>
</body>
</html>
`;

  return { subject, html, text };
}

/**
 * Generates the fulfillment success email after customer target fix.
 */
export function renderTargetFixSuccessEmail(params: {
  serviceName: string;
  publicOrderId: string;
}): { subject: string; html: string; text: string } {
  const { serviceName, publicOrderId } = params;
  const subject = `Your order #${publicOrderId} is now processing`;

  const text = `Hello,

Thank you for updating the link on order #${publicOrderId} (${serviceName}).

Your updated link has been accepted and delivery has been resumed.

Thank you,
The VANTA Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0c10; color: #ffffff; padding: 24px; margin: 0; }
    .card { background-color: #14161f; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; max-width: 520px; margin: 0 auto; padding: 32px; }
    .logo { font-size: 20px; font-weight: 800; letter-spacing: 0.1em; color: #ffffff; margin-bottom: 24px; }
    h1 { font-size: 18px; font-weight: 600; margin: 0 0 16px; color: #48bb78; }
    p { font-size: 14px; line-height: 1.6; color: rgba(255,255,255,0.7); margin: 0 0 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">VANTA</div>
    <h1>Link updated successfully</h1>
    <p>Thank you for updating the link on order <strong>#${publicOrderId}</strong> (${serviceName}).</p>
    <p>Your order has been resumed and is now being delivered.</p>
  </div>
</body>
</html>
`;

  return { subject, html, text };
}

/**
 * Generates customer notification email when money is manually added to their wallet by support.
 */
export function renderWalletCreditEmail(params: {
  amountGhs: number;
}): { subject: string; html: string; text: string } {
  const { amountGhs } = params;
  const formattedAmount = amountGhs.toFixed(2);
  const subject = `Account Credit: GHS ${formattedAmount} added to your wallet`;

  const text = `Hello,

GHS ${formattedAmount} has been added to your VANTA wallet.

You can use your wallet balance toward any order on VANTA.

View your wallet: ${process.env.NEXT_PUBLIC_APP_URL || "https://vantasocials.shop"}/account/wallet

Thank you,
The VANTA Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0c10; color: #ffffff; padding: 24px; margin: 0; }
    .card { background-color: #14161f; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; max-width: 520px; margin: 0 auto; padding: 32px; }
    .logo { font-size: 20px; font-weight: 800; letter-spacing: 0.1em; color: #ffffff; margin-bottom: 24px; }
    h1 { font-size: 18px; font-weight: 600; margin: 0 0 16px; color: #48bb78; }
    p { font-size: 14px; line-height: 1.6; color: rgba(255,255,255,0.7); margin: 0 0 16px; }
    .amount-box { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0; }
    .amount-val { font-size: 24px; font-weight: 700; color: #48bb78; }
    .btn { display: inline-block; background-color: #ffffff; color: #000000; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">VANTA</div>
    <h1>Account Credit Received</h1>
    <p>GHS ${formattedAmount} has been added to your VANTA wallet.</p>
    <div class="amount-box">
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(255,255,255,0.5); margin-bottom: 4px;">Wallet Credit</div>
      <div class="amount-val">+GHS ${formattedAmount}</div>
    </div>
    <p>These funds are immediately available to use on any order.</p>
    <div style="text-align: center; margin-top: 24px;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://vantasocials.shop"}/account/wallet" class="btn">View Wallet Balance</a>
    </div>
  </div>
</body>
</html>
`;

  return { subject, html, text };
}

/**
 * Generates the customer notification email when an order is refunded to their wallet.
 */
export function renderOrderRefundEmail(params: {
  publicOrderId: string;
  serviceName: string;
  amountGhs: number;
}): { subject: string; html: string; text: string } {
  const { publicOrderId, serviceName, amountGhs } = params;
  const formattedAmount = amountGhs.toFixed(2);
  const subject = `Order #${publicOrderId} Refunded to Wallet`;

  const text = `Hello,

Your order #${publicOrderId} (${serviceName}) couldn't be delivered.

GHS ${formattedAmount} has been returned to your VANTA wallet. You can use your wallet balance toward any future order or top up at any time.

View your wallet and orders: ${process.env.NEXT_PUBLIC_APP_URL || "https://vantasocials.shop"}/account/wallet

Thank you,
The VANTA Team`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0c10; color: #ffffff; padding: 24px; margin: 0; }
    .card { background-color: #14161f; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; max-width: 520px; margin: 0 auto; padding: 32px; }
    .logo { font-size: 20px; font-weight: 800; letter-spacing: 0.1em; color: #ffffff; margin-bottom: 24px; }
    h1 { font-size: 18px; font-weight: 600; margin: 0 0 16px; color: #6366f1; }
    p { font-size: 14px; line-height: 1.6; color: rgba(255,255,255,0.7); margin: 0 0 16px; }
    .amount-box { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0; }
    .amount-val { font-size: 24px; font-weight: 700; color: #ffffff; }
    .btn { display: inline-block; background-color: #ffffff; color: #000000; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">VANTA</div>
    <h1>Order Refunded</h1>
    <p>Your order <strong>#${publicOrderId}</strong> (${serviceName}) couldn't be delivered.</p>
    <div class="amount-box">
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(255,255,255,0.5); margin-bottom: 4px;">Credited to Wallet</div>
      <div class="amount-val">GHS ${formattedAmount}</div>
    </div>
    <p>The funds are immediately available in your VANTA wallet to use on any order.</p>
    <div style="text-align: center; margin-top: 24px;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://vantasocials.shop"}/account/wallet" class="btn">View Wallet Balance</a>
    </div>
  </div>
</body>
</html>
`;

  return { subject, html, text };
}
