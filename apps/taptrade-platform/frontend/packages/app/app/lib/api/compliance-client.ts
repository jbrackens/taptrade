import { apiClient } from "./client";

/**
 * Upload a KYC document (ID, passport, proof of address, etc.)
 */
export async function uploadKycDocument(
  userId: string,
  file: File,
  documentType: string,
): Promise<{ documentId: string; status: string }> {
  // The gateway KYC service records document METADATA as JSON — it does
  // not accept a multipart binary (KYC is a mock; submit-document decodes
  // {userId,type,...} and is session-bound). The previous implementation
  // POSTed multipart snake_case with a raw fetch + Bearer header, which
  // 400'd on the JSON contract and would 403 on the missing CSRF
  // double-submit token. Mirror verifyIdentity: shared apiClient (cookie
  // auth + CSRF + credentials), JSON camelCase. The picked file is a UX
  // affordance only; just its type is submitted.
  void file;
  const raw = await apiClient.post<{
    document?: { id?: string; documentId?: string; status?: string };
  }>("/api/v1/compliance/kyc/submit-document", {
    userId,
    type: documentType,
  });
  const doc = raw.document ?? {};
  return {
    documentId: doc.documentId || doc.id || "",
    status: doc.status ?? "submitted",
  };
}

/**
 * Submit identity documents for KYC verification (LC-22 / D-8). The gateway
 * binds this to the authenticated session, so the userId is the caller's.
 * Returns the resulting KYC result (status: pending | approved | declined).
 */
export async function verifyIdentity(
  userId: string,
  documentType: string = "passport",
): Promise<{ status: string }> {
  // Use the shared apiClient so the CSRF token (double-submit) and
  // credentials are attached exactly like every other compliance mutation.
  // A raw fetch here previously 403'd with "missing CSRF token header".
  const raw = await apiClient.post<{ result?: { status?: string } }>(
    "/api/v1/compliance/kyc/verify",
    {
      userId,
      documents: [{ type: documentType }],
    },
  );
  return { status: raw.result?.status ?? "pending" };
}
