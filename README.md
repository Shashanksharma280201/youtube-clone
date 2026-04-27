# YouTube Clone

A full-stack video sharing platform where users can create accounts, upload videos, and watch videos uploaded by other users.

---

## Features

- User registration and login with secure password hashing
- Upload videos with a title and description
- Home page displaying all videos from all users
- Video watch page with an HTML5 player, view count, and like count
- Fully responsive dark UI
- Automatic deployment via GitHub and Vercel CI/CD

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Framework | Next.js 14 (App Router) | Full-stack in one codebase, React-based |
| Language | TypeScript | Type safety, better developer experience |
| Database | PostgreSQL via Neon | Scalable, relational, free tier available |
| ORM | Prisma | Type-safe database queries without raw SQL |
| Auth | NextAuth.js | Handles sessions, JWT, and credentials securely |
| Storage | Vercel Blob (prod) / Local filesystem (dev) | Simple, scalable video storage |
| Styling | Tailwind CSS | Utility-first, fast to build with |
| Hosting | Vercel | Native Next.js support, auto-deploy from GitHub |

---

## Local Development Setup

### Prerequisites

- Node.js 18 or higher
- A Neon account (free) for the PostgreSQL database

### Steps

1. Clone the repository

```bash
git clone https://github.com/Shashanksharma280201/youtube-clone.git
cd youtube-clone
```

2. Install dependencies

```bash
npm install
```

3. Set up environment variables

Create a `.env.local` file in the root:

```
DATABASE_URL="your_neon_connection_string"
NEXTAUTH_SECRET="your_random_secret"
NEXTAUTH_URL="http://localhost:3000"
```

Create a `.env` file for Prisma CLI:

```
DATABASE_URL="your_neon_connection_string"
```

To generate a secure NEXTAUTH_SECRET:

```bash
openssl rand -base64 32
```

4. Set up the database

```bash
npx prisma generate
npx prisma db push
```

5. Create the local uploads folder

```bash
mkdir -p public/uploads/videos
```

6. Start the development server

```bash
npm run dev
```

Open http://localhost:3000

When running locally without a `BLOB_READ_WRITE_TOKEN`, uploaded videos are saved to `public/uploads/videos/` on your machine.

---

## Deploying to Vercel

1. Push the repository to GitHub
2. Go to vercel.com, create a new project, and import the GitHub repository
3. In the Vercel project dashboard, go to Storage and create a Blob store named `video-uploads`
4. Add the following environment variables in Vercel Settings:

```
DATABASE_URL
NEXTAUTH_SECRET
NEXTAUTH_URL        (set to your Vercel domain, e.g. https://your-app.vercel.app)
BLOB_READ_WRITE_TOKEN
```

5. Deploy. Every subsequent push to the main branch will trigger an automatic redeployment.

---

## Project Structure

```
src/
  app/
    api/
      auth/[...nextauth]/   NextAuth handler
      register/             User registration endpoint
      upload/               Video upload endpoint
      videos/               Fetch all videos or single video
    login/                  Login page
    register/               Register page
    upload/                 Upload page (protected)
    watch/[id]/             Video watch page
    layout.tsx              Root layout with Navbar
    page.tsx                Home page with video grid
  components/
    Navbar.tsx              Top navigation bar
    VideoCard.tsx           Individual video card
    VideoGrid.tsx           Responsive grid of video cards
    SessionProvider.tsx     NextAuth session wrapper
  lib/
    auth.ts                 NextAuth configuration
    prisma.ts               Prisma client singleton
    utils.ts                Helper functions (timeAgo, formatViews)
  types/
    next-auth.d.ts          Extended session types
prisma/
  schema.prisma             Database schema (User, Video, Like, Comment)
```

---

## Database Schema

- User — stores name, email, hashed password
- Video — stores title, description, video URL, view count, linked to uploader
- Like — links a user to a video they liked, unique per user per video
- Comment — stores comment text, linked to user and video

---

## Available Scripts

```bash
npm run dev          Start development server
npm run build        Build for production
npm run start        Start production server
npm run db:push      Push schema changes to database
npm run db:generate  Regenerate Prisma client
npm run db:studio    Open Prisma Studio (visual database browser)
```
