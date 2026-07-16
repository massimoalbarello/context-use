export async function requireAuthenticationUserVerification(pathname: string, response: Response): Promise<Response> {
  if (!response.ok || !pathname.endsWith("/passkey/generate-authenticate-options")) return response;
  const payload = await response.json() as Record<string, unknown>;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json({ ...payload, userVerification: "required" }, {
    status: response.status,
    headers,
  });
}
