import { minifiedResult, resolveView, stripMediaUrls, viewParam, type View } from '@chrischall/mcp-utils';

/**
 * The rungs this server honours (`@chrischall/mcp-utils`' `view` vocabulary;
 * `chrischall/workflows` `docs/fleet-conventions.md`, "Response shape").
 *
 * **What compact does here, and what it deliberately does NOT do.**
 *
 * The read tools in this server hand back Resy's payload close to
 * verbatim, and the repo holds no verified record of what those payloads
 * contain — no captured fixture, no documented field list. So nothing here can
 * honestly say which of Resy's fields matter and which are noise.
 *
 * Compact therefore does the one projection that needs no such knowledge: it
 * strips image and avatar URLs. That is SUBTRACTIVE, so it cannot lose a field
 * nobody knew about — the failure an invented field list would risk, where a
 * record comes back with holes in it and reads like a verified answer.
 *
 * When a real payload can be captured, a field projection belongs here beside
 * this one and will save considerably more. Until then this is the honest
 * ceiling, and this docblock says so rather than implying a shape was checked.
 */
export const RESY_VIEWS = ['compact', 'full'] as const;

const NOTE =
  'compact strips image/avatar URLs from the response; "full" returns Resy\'s payload untouched. ' +
  'No field projection: this server has no verified record of which Resy fields matter, and inventing ' +
  'one would risk dropping a field a caller needs.';

/** The `view` parameter every read tool in this server takes. */
export const viewArg = (): ReturnType<typeof viewParam> => viewParam(RESY_VIEWS, { note: NOTE });

/**
 * `profile_image_url` is named explicitly, and that is what makes its removal
 * DETERMINISTIC rather than accidental.
 *
 * It is the one media field any read tool in this server hands back
 * (`resy_get_profile`, `src/tools/user.ts`), and it is read straight off
 * Resy's `/2/user` payload. Nothing here derives it, so it is exactly the
 * pass-through CDN URL `stripMediaUrls` exists to remove: a model cannot see
 * it, cannot fetch it, and gains nothing from carrying it.
 *
 * The built-in rules do NOT catch it. `MEDIA_KEY` anchors its noun at the
 * START of the key — the property that keeps a `has_photo: false` alive — and
 * `profile_image_url` starts `profile_`, which the pattern knows only as
 * `profile_pic`/`profile_picture`. That leaves the VALUE rule, which fires
 * only when the URL's path ends in an image extension. Resy's avatar URLs are
 * served from an image pipeline whose path need not end in one, so the field
 * could silently start surviving compact with nothing here to explain it.
 *
 * Nothing is KEPT: no tool in this server has a picture for its product, so
 * there is no payload here that mixes decoration with content.
 */
const DROP = ['profile_image_url'] as const;

/**
 * Answer in the requested rung.
 *
 * Only ever called from a READ tool. A write's response is a receipt — an id,
 * a status — with nothing to strip and everything to keep.
 */
export function viewResponse(view: string | undefined, data: unknown): ReturnType<typeof minifiedResult> {
  const rung: View = resolveView(view, RESY_VIEWS);
  return minifiedResult(rung === 'compact' ? stripMediaUrls(data, { drop: DROP }) : data);
}
