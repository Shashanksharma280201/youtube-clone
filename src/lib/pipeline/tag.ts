// GPT-4o-mini: derive the video's phases once, then tag each spoken segment
// into one of those phases. Tagging needs the WHOLE transcript for consistent
// phase vocabulary, so this runs after all segments are transcribed.
import { mergeOrphanOther } from "./mergeOther";
import { chatComplete } from "./openai";
import { TAG_BATCH_SIZE, type RawSegment, type TaggedSegment } from "./types";

export async function analyzeVideo(
  sampleText: string,
): Promise<{ category: string; phases: string[] }> {
  try {
    const res = await chatComplete({
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Analyze this video transcript and return:
1. "category": the video type (e.g. "Laptop Repair", "Cooking Tutorial", "Unboxing", "Teaching", "Workout", etc.)
2. "phases": 4-8 single-word phase labels describing the main stages of THIS specific video. Title Case.
Return JSON: { "category": "...", "phases": ["Phase1", "Phase2", ...] }`,
        },
        { role: "user", content: sampleText },
      ],
    }, { mini: true });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}");
    return {
      category: typeof parsed.category === "string" ? parsed.category : "General",
      phases: Array.isArray(parsed.phases) ? parsed.phases : [],
    };
  } catch {
    return { category: "General", phases: [] };
  }
}

export async function tagSegments(
  segments: RawSegment[],
  phases: string[],
): Promise<TaggedSegment[]> {
  if (segments.length === 0) return [];

  const phaseHint =
    phases.length > 0
      ? `Choose "m" for each segment from this list, picking the closest match: ${phases.join(", ")}, other. Use "other" ONLY when none genuinely fit — avoid it whenever a real phase applies.`
      : `Choose "m" from: introduction, overview, diagnosis, repair, testing, verification, safety, parts, conclusion, other. Use "other" ONLY as a last resort.`;

  const batches: RawSegment[][] = [];
  for (let i = 0; i < segments.length; i += TAG_BATCH_SIZE)
    batches.push(segments.slice(i, i + TAG_BATCH_SIZE));

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const input = batch.map((s, i) => ({ i, t: s.text.slice(0, 200) }));
      try {
        const completion = await chatComplete({
          temperature: 0,
          max_tokens: 1600,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: `Tag each transcript segment with:
- "m": the phase label (see the list below)
- "s": 2-5 word specific description (sub tag)
${phaseHint}
Return ONLY JSON — no input text: {"segments":[{"i":0,"m":"introduction","s":"Overview of the parts"},{"i":1,"m":"diagnosis","s":"Testing battery voltage"}]}`,
            },
            { role: "user", content: JSON.stringify(input) },
          ],
        }, { mini: true });
        const raw = completion.choices[0]?.message?.content ?? "{}";
        const parsed: { segments?: { i: number; m: string; s: string }[] } = JSON.parse(raw);
        const map = new Map(parsed.segments?.map((x) => [x.i, x]) ?? []);
        return batch.map((_, j) => ({
          mainTag: (map.get(j)?.m ?? "Other").toLowerCase().trim(),
          subTag: (map.get(j)?.s ?? "").trim(),
        }));
      } catch (err) {
        console.warn(`[tag] batch of ${batch.length} failed -> 'other':`, err);
        return batch.map(() => ({ mainTag: "other", subTag: "" }));
      }
    }),
  );

  const allTags = batchResults.flat();
  const tagged = segments.map((seg, i) => ({
    ...seg,
    mainTag: allTags[i]?.mainTag ?? "other",
    subTag: allTags[i]?.subTag ?? "",
  }));
  return mergeOrphanOther(tagged);
}
