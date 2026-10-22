import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  CATALOG_PATH,
  githubGetCatalog,
  githubPutCatalog,
  normalizeCatalog,
  verifySessionToken,
} from "./_admin-util";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const { catalog, storage } = await githubGetCatalog();
      return res.status(200).json({ catalog, storage, path: CATALOG_PATH });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      const token = String(body.token ?? body?.data?.token ?? "");
      if (!verifySessionToken(token)) {
        return res.status(401).json({ ok: false, error: "Admin session expired. Please sign in again." });
      }
      const incoming = body.catalog ?? body?.data?.catalog;
      const { sha } = await githubGetCatalog();
      const next = normalizeCatalog({
        ...incoming,
        updatedAt: new Date().toISOString(),
      });
      await githubPutCatalog(next, sha);
      return res.status(200).json({ ok: true, catalog: next });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: (e as Error).message || "Catalog request failed",
    });
  }
}
