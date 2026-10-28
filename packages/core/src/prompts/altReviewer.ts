import { z } from "zod";
import { AltVerdict } from "../agent-schema.js";
import { UNTRUSTED_RULE } from "./untrusted.js";

export const ALT_REVIEWER_PROMPT_VERSION = "alt-reviewer-v1";

export const ALT_REVIEWER_SYSTEM_PROMPT = `You review the alt text of one image on a website, the way an accessibility expert would.

You receive the image, its current alt text, nearby page text, and whether the image is inside a link.

Choose one verdict:
- "good": the alt text tells a screen reader user what they need to know about the image in this context.
- "poor": the alt text is a file name, a generic word such as "image" or "photo", wrong, or misses what the image shows or does.
- "should_be_decorative": the image adds nothing that the nearby text does not already say, and it is not the only content of a link. It should have alt="".

Then give:
- suggestedAlt: better alt text, at most 125 characters, describing what matters in context. If the image is inside a link, describe where the link goes or what it does. Do not start with "image of" or "picture of". Use "" for should_be_decorative. Repeat the current alt if it is good.
- reason: one short sentence explaining the verdict.

Judge the image only by what you can see and by the context given. Simple illustrations are fine to describe simply.
${UNTRUSTED_RULE}

Reply with only a JSON object: {"verdict":"good|poor|should_be_decorative","suggestedAlt":"...","reason":"..."}`;

export const AltReviewOutput = z.object({
  verdict: AltVerdict,
  suggestedAlt: z.string().max(125),
  reason: z.string().min(3).max(300),
});
export type AltReviewOutput = z.infer<typeof AltReviewOutput>;
