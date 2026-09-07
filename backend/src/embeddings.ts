import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";

env.cacheDir = "./model-cache";

type FeatureExtractor = (text: string, options: { pooling: "mean"; normalize: boolean }) => Promise<{
  data: Float32Array;
}>;

let extractor: FeatureExtractor | null = null;

async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: "q8" }) as unknown as FeatureExtractor;
  }

  return extractor;
}

export async function createEmbedding(text: string): Promise<number[]> {
  const featureExtractor = await getExtractor();
  const result = await featureExtractor(text, { pooling: "mean", normalize: true });
  return Array.from(result.data);
}

export function cosineSimilarity(first: number[], second: number[]): number {
  const length = Math.min(first.length, second.length);
  let dotProduct = 0;
  let firstNorm = 0;
  let secondNorm = 0;

  for (let index = 0; index < length; index += 1) {
    dotProduct += first[index] * second[index];
    firstNorm += first[index] ** 2;
    secondNorm += second[index] ** 2;
  }

  return firstNorm && secondNorm ? dotProduct / Math.sqrt(firstNorm * secondNorm) : 0;
}
