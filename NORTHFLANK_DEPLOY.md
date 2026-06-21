# Northflank Deploy Guide

## 1. Push to GitHub

Create a private GitHub repository and upload this project.

Do not upload:

- `.env`
- `data/`
- `node_modules/`

Those are already ignored.

## 2. Create Northflank Service

1. Open Northflank.
2. Create a new project.
3. Create a service from GitHub.
4. Select this repository.
5. Choose Dockerfile build.
6. Start command is already inside the Dockerfile:

```bash
npm start
```

## 3. Environment Variables

Add every value from your local `.env` into Northflank environment variables.

Required:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
MOD_ROLE_ID=
START_CHANNEL_ID=
DEPOSIT_LOG_CHANNEL_ID=
CONFIRM_LOG_CHANNEL_ID=
RELEASE_LOG_CHANNEL_ID=
REPORT_PANEL_CHANNEL_ID=
INFO_CHANNEL_ID=
DISPUTE_CATEGORY_ID=
PROOF_CHANNEL_ID=
RULES_CHANNEL_ID=
REVIEW_CHANNEL_ID=
CLOSE_ROLE_ID=
DISPUTE_LOG_CHANNEL_ID=
ESCROW_OPEN_LOG_CHANNEL_ID=
ESCROW_CLOSE_LOG_CHANNEL_ID=
FEE_PERCENT=8
CURRENCY=EUR
PAYPAL_VAULT_EMAIL=
PAYMENT_MODE=manual
```

## 4. Deploy Commands

Slash commands only need to be deployed when command definitions change.

Run locally:

```bash
npm.cmd run deploy:commands
```

Then deploy/restart the Northflank service.

## Important Storage Note

The bot currently stores data in `data/escrow-db.json`. On container hosting this can be lost if the container is recreated.

For real usage, migrate `src/db.js` to Postgres or attach persistent storage if your Northflank plan supports it.
