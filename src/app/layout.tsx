import type { Metadata } from 'next'
import './globals.css'
import SessionProvider from '@/components/SessionProvider'
import Navbar from '@/components/Navbar'

export const metadata: Metadata = {
  title: 'YT Clone',
  description: 'A YouTube-like video sharing platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-yt-dark text-yt-text min-h-screen">
        <SessionProvider>
          <Navbar />
          <main className="pt-14">{children}</main>
        </SessionProvider>
      </body>
    </html>
  )
}
