# Simulust

Adult AI companions, paid in USDC or SOL on Solana. Setup and launch checklist: [docs/SETUP.md](docs/SETUP.md). Code map and API: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Accounts and wallets.** Accounts are a username and password only: no email, social or wallet login. Sign-up asks for a date of birth (18+, re-checked on the server; only the confirmation time is stored) and shows a one-time recovery code, the only way to reset a forgotten password. Every account gets an embedded Solana wallet from Privy through its JWT-based auth: our server signs a short-lived token for the user and publishes the public key at `/api/auth/jwks`, so Privy never sees the password. Without `NEXT_PUBLIC_PRIVY_APP_ID` (local development) there's no wallet and everything else works.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
