# GraphicyCRM — User Guide

This document is the knowledge source for the in-app Help Assistant
(`modules/help-bot`). It's written for the person **using** GraphicyCRM day
to day, not for developers — plain language, what things are called in the
UI, and how to actually do things. Keep entries here short, task-oriented,
and matching the real labels/buttons in the app so the bot's answers line up
with what the user is looking at on screen.

If you add a new feature to the product, add a section here too — the bot
only knows what's written down in this file.

---

## What GraphicyCRM is

GraphicyCRM is a unified CRM for businesses that talk to customers across
WhatsApp, Instagram, Facebook, Threads, Gmail, and web forms/spreadsheets.
One login, one inbox, one lead list — no matter which channel a customer
messages in.

## Signing in

- One login works for everything: the dashboard, every connected channel,
  and the mobile inbox. There's no separate login per platform.
- Accounts are created by an admin (via `/admin/register.html`), not open
  self-signup — if you don't have an account, ask whoever administers your
  CRM instance to create one for you.
- Forgot your session? Just sign in again at `/login.html`.

## Dashboard

The Dashboard is the home screen — a quick snapshot of pipeline health:
total leads, how many converted, how many are lost, and how many are still
pending. Use it to get a feel for how things are trending; use Leads or
Reports for the details behind those numbers.

## Inbox

The Inbox is a **unified conversation view** — every message from every
connected channel (WhatsApp, Instagram, Facebook, Email/Gmail) lands here as
one thread per contact, most recently active first.

- Tabs across the top filter by channel: All, WhatsApp, Instagram, Facebook,
  Email.
- The search box filters by contact name or message content.
- Click a conversation to open the thread and see the full message history.
- A colored dot on a thread means it "needs a reply" — the last message in
  that thread came from the contact, not from you.
- To reply, open the thread, pick a channel from the dropdown next to the
  message box (defaults to the channel the conversation is already on), type
  your message, and hit Send.
- WhatsApp has a **24-hour rule**: Meta only allows free-form replies within
  24 hours of the customer's last message (GraphicyCRM enforces a 22-hour
  window to be safe). Outside that window, you must send an **approved
  template** message instead — see "Templates" below.

## Leads

Leads is the full list of everyone who has contacted you (or been imported),
regardless of channel.

- Each lead has a status: new, contacted, engaged, converted, or lost. Update
  status as a deal moves forward — this is what powers the Dashboard's
  counts and the Reports charts.
- Click into a lead to see their contact info, notes, and full message
  history across every channel they've used.
- You can add notes to a lead — useful for context your team needs before
  the next conversation.
- Leads can come from WhatsApp, Instagram, Facebook, a web form, email, a
  connected spreadsheet, or be entered manually ("other").

## Contacts

Contacts is a simpler, flatter list of people you've messaged or been
messaged by — useful for quickly finding someone by name, phone, or email
without needing the full lead-pipeline view.

## Templates

Templates are pre-written messages you can reuse.

- **Plain text templates** — just a saved snippet of text you can drop into
  a reply. No approval needed, use them any time.
- **WhatsApp Business templates** — these must be submitted to Meta and
  approved before they can be sent. They're required for messaging a
  WhatsApp contact outside the 24-hour reply window (e.g. following up on
  an old lead, or sending an appointment reminder days later).
- To create a WhatsApp template: give it a name (lowercase letters, numbers,
  underscores only — this is a Meta requirement), write the body text (use
  `{{placeholder}}` for parts that change per-contact, like a name or order
  number), optionally add a header, footer, or buttons, then submit for
  review. Approval typically takes anywhere from a few minutes to a day and
  is decided by Meta, not GraphicyCRM.
- Once approved, a template shows up in the template picker wherever you're
  replying to a WhatsApp contact outside the reply window — pick it, fill in
  the placeholder values, and send.

## Automations

Automations let the CRM respond to incoming messages automatically, without
someone manually typing a reply every time.

- Each automation rule matches on keywords in an incoming message (e.g. "hi"
  or "hello" trigger a welcome reply, contains/exact match options
  available).
- A matched rule can reply with a fixed template, or generate a reply with
  AI (using one of the connected AI models) grounded in extra context you
  provide.
- Rules can also do a spreadsheet lookup — e.g. check a connected Google
  Sheet to see if a phone number/order number exists, and branch the reply
  based on whether it was found (`{{sheet_lookup}}` matches, or a
  `__not_found__` fallback branch).
- Rules can schedule a **follow-up** message automatically if the contact
  doesn't reply within a set number of hours.

## Sources / Integrations

This is where you connect the actual channels:

- **WhatsApp**: no OAuth login — you connect it with a WABA (WhatsApp
  Business Account) ID and an access token from Meta Business Settings. You
  can verify the WABA first to see which phone numbers are on it before
  connecting one.
- **Facebook, Instagram, Threads**: connected via "Connect" buttons that
  redirect you to Meta's OAuth login. Connecting Facebook automatically
  links the Page's Instagram Business account too, if there is one.
- **Gmail**: connected via Google OAuth — once connected, email replies from
  the Inbox go out through your actual Gmail account.
- **Google Sheets / Docs**: also connected via Google OAuth (the same
  "Connect Google" step covers Gmail, Sheets, and Docs together). Sheets are
  used for automation lookups and for "sheet watchers" (see below); Docs can
  be used to ground AI-generated automation replies in a longer document.
- You can disconnect any of these at any time from the same screen.

## Sheet Watchers

A sheet watcher links rows in a connected Google Sheet to leads in the CRM —
useful if leads come in from a form that writes to a spreadsheet. New rows
in the watched sheet/tab automatically become new leads.

## Settings

General account and messaging settings — for example, WhatsApp auto-reply
mode (off / AI-generated / fixed template), the AI model used for automated
replies, and rate limits (messages per hour/day, minimum/maximum gap between
automated sends) to avoid looking spammy or hitting Meta's own limits.

## Schedule (content publishing)

Separate from the Inbox — this is for scheduling and publishing posts to
Facebook, Instagram, Threads, and LinkedIn. Create a post with a caption and
optional media, pick which platforms to publish to, and either schedule it
for later or publish immediately. Published posts show their status and any
publish errors per platform.

## Insights

Analytics for your connected social accounts (Facebook, Instagram,
Threads): follower counts, post-level engagement (likes, comments, shares,
reach), and historical snapshots so you can see trends over time.

## Reports

Pipeline-level reporting — how leads are moving through your funnel over a
given period, broken down by status, source, or channel.

## Mobile WhatsApp Inbox (`/mobile.html`)

A phone-friendly, WhatsApp-focused version of the Inbox — same underlying
data as the desktop Inbox tab, filtered to WhatsApp conversations, designed
for quick replies on the go. Same 24-hour/template rules apply as the
desktop Inbox.

## Common questions

- **"Why can't I send a plain message to this WhatsApp contact?"** — the
  24-hour reply window has probably closed. Use an approved WhatsApp
  template instead (see "Templates").
- **"My WhatsApp template isn't showing up in the picker"** — it needs to be
  approved by Meta first (status must be APPROVED, not PENDING or
  REJECTED). Approval can take time and is decided by Meta, not GraphicyCRM.
- **"A lead's channel shows the wrong icon"** — the Inbox shows a contact's
  most recent message's channel; if they've messaged you on more than one
  platform, the icon reflects whichever was most recent.
- **"I connected a channel but messages aren't showing up"** — double-check
  the webhook/subscription is active on the platform's side (this is set up
  automatically when you connect through GraphicyCRM, but can be revoked on
  Meta's side independently) and that the account is still marked active
  under Sources.