import { describe, it, expect } from 'vitest'
import { isHallucination } from '@/lib/pipeline/transcribe'

const seg = (text: string, no_speech_prob = 0, start = 0) =>
  ({ id: 1, start, end: start + 2, text, no_speech_prob })

const DURATION = 600

describe('isHallucination', () => {
  it('keeps real English speech', () => {
    expect(isHallucination(seg('Start the machine by pressing the button.'), DURATION)).toBe(false)
  })

  // Regression: an ASCII-only "real characters" test discarded every non-Latin
  // segment, leaving Hindi/Arabic/Chinese videos with a completely empty transcript.
  it('keeps Hindi (Devanagari) speech', () => {
    expect(isHallucination(seg('चाय पॉइंट मशीन को कैसे चालू करें'), DURATION)).toBe(false)
  })

  it('keeps Arabic speech', () => {
    expect(isHallucination(seg('كيفية تشغيل الآلة'), DURATION)).toBe(false)
  })

  it('keeps Chinese speech', () => {
    expect(isHallucination(seg('如何启动机器'), DURATION)).toBe(false)
  })

  it('still drops punctuation-only noise', () => {
    expect(isHallucination(seg('...'), DURATION)).toBe(true)
  })

  it('still drops a segment above the no-speech threshold', () => {
    expect(isHallucination(seg('Some words here', 0.9), DURATION)).toBe(true)
  })

  it('still drops a segment starting past the video duration', () => {
    expect(isHallucination(seg('Some words here', 0, DURATION + 10), DURATION)).toBe(true)
  })
})
