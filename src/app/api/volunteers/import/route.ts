import { apiOk, validationError } from "@/lib/api/response";
import { protectedRoute } from "@/lib/api/route";
import { requireAuthContext, assertManageVolunteerMaster, assertSameOrigin } from "@/lib/authorization/require";
import { parseAndPreview } from "@/services/import-service";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

/** Step 1 of import: parse + validate only. Nothing is written to the DB. */
export const POST = protectedRoute(async (req, requestId) => {
  assertSameOrigin(req);
  const ctx = await requireAuthContext({ requestId, provision: true });
  assertManageVolunteerMaster(ctx);

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    throw validationError({ file: "Expected a multipart upload." });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw validationError({ file: "Upload an .xlsx file." });
  if (file.size === 0) throw validationError({ file: "The file is empty." });
  if (file.size > MAX_BYTES) throw validationError({ file: "File too large (max 5 MB)." });

  const buffer = Buffer.from(await file.arrayBuffer());
  let preview;
  try {
    preview = await parseAndPreview(buffer);
  } catch (err) {
    throw validationError({
      file: err instanceof Error ? err.message : "Could not read the spreadsheet.",
    });
  }

  return apiOk(preview, requestId);
});
