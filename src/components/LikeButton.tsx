'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

interface LikeButtonProps {
  videoId: string
  initialLiked: boolean
  initialCount: number
}

export default function LikeButton({ videoId, initialLiked, initialCount }: LikeButtonProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const [liked, setLiked] = useState(initialLiked)
  const [count, setCount] = useState(initialCount)
  const [loading, setLoading] = useState(false)

  async function handleLike() {
    if (!session) {
      router.push('/login')
      return
    }

    setLoading(true)
    const res = await fetch(`/api/videos/${videoId}/likes`, { method: 'POST' })
    const data = await res.json()
    setLoading(false)

    if (res.ok) {
      setLiked(data.liked)
      setCount(data.count)
    }
  }

  return (
    <button
      onClick={handleLike}
      disabled={loading}
      className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-50 ${
        liked
          ? 'bg-white text-black hover:bg-gray-200'
          : 'bg-yt-surface hover:bg-yt-hover text-yt-text border border-yt-border'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={liked ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        className="w-5 h-5"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
      </svg>
      {count} {count === 1 ? 'Like' : 'Likes'}
    </button>
  )
}
