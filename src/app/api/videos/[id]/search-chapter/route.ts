import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

type TopicSegment = {
  mainTag: string
  subTag: string
  start: number
  end: number
  thumbnailPath: string | null
}

type TranscriptSegment = { id: number; start: number; end: number; text: string }

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}))
  const query: string = typeof body.query === 'string' ? body.query.trim() : ''
  if (!query) return NextResponse.json({ found: false })

  const video = await prisma.video.findUnique({ where: { id: params.id } })
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const topicSegments = Array.isArray(video.topicSegments)
    ? (video.topicSegments as TopicSegment[])
    : []
  const transcriptSegs = Array.isArray(video.transcriptSegments)
    ? (video.transcriptSegments as TranscriptSegment[])
    : []

  if (topicSegments.length === 0) return NextResponse.json({ found: false })

  // Attach transcript text to each chapter for richer LLM context
  const chapters = topicSegments.map((seg, i) => {
    const text = transcriptSegs
      .filter((t) => t.start >= seg.start - 0.5 && t.start < seg.end)
      .map((t) => t.text.trim())
      .join(' ')
      .slice(0, 250)
    return { index: i, mainTag: seg.mainTag, subTag: seg.subTag, text }
  })

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 150,
      messages: [
        {
          role: 'system',
          content:
            'You are a strict video chapter search assistant. Your job has two steps:\n1. Decide if the query is genuinely about the video content shown in the chapters. If the query is unrelated (e.g. personal questions, general knowledge, off-topic subjects), set relevant=false and indices=[].\n2. Only if relevant=true, return the indices of chapters that directly cover the query. Do NOT pick the closest guess — if nothing truly matches, set indices=[].\n\nBe strict. It is correct and expected to return relevant=false or indices=[] when the query does not match.',
        },
        {
          role: 'user',
          content: `Query: "${query}"

Chapters:
${chapters.map((c) => `[${c.index}] ${c.mainTag} / ${c.subTag}${c.text ? `: "${c.text}"` : ''}`).join('\n')}

Return JSON: {"relevant": <true|false>, "indices": [<matching chapter indices, empty array if none or not relevant>]}`,
        },
      ],
    })

    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}')

    if (!parsed.relevant) return NextResponse.json({ found: false })

    const indices: number[] = Array.isArray(parsed.indices)
      ? parsed.indices.filter((i: unknown) => typeof i === 'number' && i >= 0 && i < topicSegments.length)
      : []

    if (indices.length === 0) return NextResponse.json({ found: false })

    return NextResponse.json({
      found: true,
      results: indices.map((i) => ({ index: i, segment: topicSegments[i] })),
    })
  } catch (err) {
    console.error('[search-chapter]', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
