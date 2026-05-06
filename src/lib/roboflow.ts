const ROBOFLOW_BASE = "https://serverless.roboflow.com";

type Prediction = { masks?: number[][][] };

// concept_segment wraps predictions inside prompt_results
function extractConceptMasks(data: { prompt_results?: { predictions?: Prediction[] }[] }): number[][][] {
  return (data.prompt_results?.[0]?.predictions ?? []).flatMap((p) => p.masks ?? []);
}

// visual_segment puts predictions at the top level
function extractVisualMasks(data: { predictions?: Prediction[] }): number[][][] {
  return (data.predictions ?? []).flatMap((p) => p.masks ?? []);
}

export async function conceptSegment(imageUrl: string, prompt: string): Promise<number[][][]> {
  const res = await fetch(
    `${ROBOFLOW_BASE}/sam3/concept_segment?api_key=${process.env.ROBOFLOW_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: { type: "url", value: imageUrl },
        prompts: [{ type: "text", text: prompt }],
        format: "polygon",
        output_prob_thresh: 0.4,
      }),
    }
  );
  if (!res.ok) throw new Error(`Roboflow concept_segment ${res.status}: ${await res.text()}`);
  return extractConceptMasks(await res.json());
}

export async function visualSegment(
  imageBase64: string,
  points: { x: number; y: number; positive: boolean }[]
): Promise<number[][][]> {
  const res = await fetch(
    `${ROBOFLOW_BASE}/sam3/visual_segment?api_key=${process.env.ROBOFLOW_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image: { type: "base64", value: imageBase64 },
        prompts: [{ points }],
        format: "polygon",
      }),
    }
  );
  if (!res.ok) throw new Error(`Roboflow visual_segment ${res.status}: ${await res.text()}`);
  return extractVisualMasks(await res.json());
}
