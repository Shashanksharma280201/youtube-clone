import { describe, it, expect } from 'vitest'
import { isHallucination } from '@/lib/pipeline/transcribe'

const seg = (text: string, no_speech_prob = 0, start = 0, avg_logprob = 0) =>
  ({ id: 1, start, end: start + 2, text, no_speech_prob, avg_logprob })

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

  // Regression: real Hindi speech comes back with a HIGH no_speech_prob (~0.87)
  // but a healthy avg_logprob (~-0.37). Dropping on no_speech_prob alone threw
  // away 31 of 35 genuine segments. Both signals must be bad.
  it('keeps confident speech even when no_speech_prob is high', () => {
    expect(
      isHallucination(seg('इस मेशीन में शुरू करने के लिए', 0.87, 0, -0.37), DURATION),
    ).toBe(false)
  })

  it('drops a segment only when no_speech_prob is high AND text confidence is low', () => {
    expect(isHallucination(seg('Some words here', 0.9, 0, -2.5), DURATION)).toBe(true)
  })

  it('keeps a low-confidence segment when whisper thinks it IS speech', () => {
    expect(isHallucination(seg('Some words here', 0.1, 0, -2.5), DURATION)).toBe(false)
  })

  it('still drops a segment starting past the video duration', () => {
    expect(isHallucination(seg('Some words here', 0, DURATION + 10), DURATION)).toBe(true)
  })
})
