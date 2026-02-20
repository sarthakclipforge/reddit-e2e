# Deployment Runbook

## Local Development
1. Clone the repository.
2. Install dependencies: `npm install`.
3. Configure `.env.local` using `.env.example`.
4. Start dev server: `npm run dev`.

## Production Deployment (Vercel)
1. Push code to a GitHub repository.
2. Link project in Vercel.
3. Add environment variables in Vercel settings.
4. Ensure `GOOGLE_REDIRECT_URI` matches the production domain.

## Environment Variables
- `GROQ_API_KEY`: Required for AI features.
- `GOOGLE_CLIENT_ID`: Required for Google Sheets.
- `GOOGLE_CLIENT_SECRET`: Required for Google Sheets.
- `GOOGLE_REDIRECT_URI`: OAuth callback URL.
- `NEXTAUTH_SECRET`: Encryption key for tokens.
