# eqy PayPal Escrow Bot

Discord escrow bot for buyer/seller PayPal trades.

- 8% service fee;
- reduced booster service fee;
- PayPal manual deposit and payout verification;
- private ticket thread per trade;
- separate log channels for each phase;
- user buttons for deposit, proof, release and dispute;
- public report ticket panel;
- partnership ticket panel;
- automatic member role and welcome message;
- review button with 1-5 rating and message;
- rules, tos and bot info publishing commands;
- blacklist for risky users;
- transcript archive and DM on ticket close;
- automatic reminders for stale escrow tickets;
- proof checklist in report/dispute tickets;
- staff private notes;
- basic daily anti-abuse limits;
- human staff dispute handling.

## PayPal Note

PayPal is not a general-purpose escrow provider. This MVP uses manual mode: the buyer pays the configured PayPal vault, staff verifies the payment, and staff later confirms the payout. Before using real money, check PayPal ToS and local legal/fiscal requirements.

## Setup

1. Install Node.js 20+.
2. Copy `.env.example` to `.env` and fill the values.
   Logs are separated by phase:
   - `START_CHANNEL_ID`: where `/escrow start` is used and start logs are posted.
   - `DEPOSIT_LOG_CHANNEL_ID`: PayPal deposit submitted logs.
   - `CONFIRM_LOG_CHANNEL_ID`: deposit confirmed and payout confirmed logs.
   - `RELEASE_LOG_CHANNEL_ID`: release, dispute, completion and cancellation logs.
   - `REPORT_PANEL_CHANNEL_ID`: public report panel and bot info channel.
   - `SUPPORT_PANEL_CHANNEL_ID`: public support panel channel.
   - `SUPPORT_CATEGORY_ID`: category where support tickets are created.
   - `DISPUTE_CATEGORY_ID`: category where report/dispute channels are created.
   - `PROOF_CHANNEL_ID`: central proof log channel.
   - `RULES_CHANNEL_ID`: rules channel.
   - `REVIEW_CHANNEL_ID`: public review log channel.
   - `CLOSE_ROLE_ID`: role allowed to use only `!close`.
   - `DISPUTE_LOG_CHANNEL_ID`: report/dispute ticket creation logs.
   - `MEMBER_ROLE_ID`: role given to new members.
   - `WELCOME_CHANNEL_ID`: channel for the welcome message. If empty, `INFO_CHANNEL_ID` is used.
   - `BOOSTER_REWARD_ROLE_ID`: role given to server boosters.
   - `BOOSTER_FEE_PERCENT`: reduced escrow fee for users with the booster reward role.
3. Install dependencies:

```bash
npm install
```

4. Deploy slash commands to your test server:

```bash
npm run deploy:commands
```

5. Start the bot:

```bash
npm start
```

## Discord Bot Settings

Enable these bot intents in the Discord Developer Portal:

- Server Members Intent
- Message Content Intent

The bot needs these server permissions:

- View Channels
- Send Messages
- Create Private Threads
- Send Messages in Threads
- Use Slash Commands
- Attach Files
- Manage Messages, optional but recommended so eqy can repost proof screenshots and remove the user's original upload
- Manage Channels, required for report/dispute ticket creation and `!close`

Staff-only actions require the role configured in `MOD_ROLE_ID`. General Discord admin permissions are not enough.

## Commands

- `/escrow start seller buyer amount description` creates a private escrow ticket.
- `/escrow deposit ticket_id paypal_transaction_id` buyer submits PayPal payment reference.
- `/escrow confirm_deposit ticket_id` staff confirms received funds.
- `/escrow release ticket_id` buyer requests seller payout.
- `/escrow confirm_payout ticket_id paypal_payout_id` staff confirms PayPal payout.
- `/escrow dispute ticket_id reason` freezes the ticket and alerts staff.
- `/escrow cancel ticket_id reason` cancels an unfunded ticket.
- `/escrow status ticket_id` shows ticket status.
- `/escrow help ticket_id` shows a compact command guide.
- `/escrow metrics` shows MVP metrics.
- `/panel` posts the public report ticket panel.
- `/supportpanel` posts the public support ticket panel.
- `/partnerpanel` posts the partnership ticket panel.
- `/verify` posts the captcha verification panel.
- `/botinfo` posts the full eqy bot explanation.
- `/rules` posts the bot rules.
- `/tos` posts terms and refund policy.
- `/blacklist add user reason` blocks a risky user from new escrow.
- `/blacklist remove user` removes a blacklist entry.
- `/blacklist check user` checks one user.
- `/blacklist list` lists current entries.
- `/profile user` shows completed tickets, disputes, blacklist status and recent tickets.
- `/queue` shows active escrow tickets for staff.
- `/export ticket_id` exports a ticket audit file.
- `/statuspanel` posts current public stats.
- `/dispute_admin resolve/refund/deny` records staff dispute outcomes.

Users can also use the ticket buttons:

- `Submit deposit`: buyer enters the PayPal transaction ID in a modal.
- `Add proof`: buyer or seller uploads a screenshot/photo; eqy reposts it cleanly.
- `Release`: buyer requests payout after delivery.
- `Dispute`: buyer or seller opens a staff dispute.
- `Review`: buyer or seller leaves a 1-5 rating and short feedback.
- `Refund`: buyer opens a refund ticket.

Staff actions intentionally stay command-only.

## Staff Prefix Commands

Inside report/dispute ticket channels:

- `!close` closes the current ticket channel. Staff and `CLOSE_ROLE_ID` can use it.
- `!dm @user reason` sends a clean DM telling the user they were tagged in the ticket.
- `!note text` saves a private staff note in the dispute log channel.
- `!partnership desc` posts the full partnership description.

On close, eqy saves a text transcript and DMs it to the buyer and seller when the closed channel is an escrow thread.

## Storage

The MVP stores state in `data/escrow-db.json` with atomic writes. For production or multiple bot processes, migrate `src/db.js` to SQLite/Postgres while keeping the same method names.

## Ticket Statuses

- `pending`: created, waiting for deposit.
- `deposit_submitted`: buyer submitted PayPal reference.
- `funded`: staff confirmed funds.
- `release_requested`: buyer requested release.
- `released`: staff confirmed payout.
- `disputed`: frozen until staff decision.
- `cancelled`: cancelled before funding.
