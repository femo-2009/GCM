import { User } from "../types";
import { mapProfileToUser } from "./userMapper";

interface SignUpPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  photo?: string;
}

async function parseApiResponse(response: Response) {
  const rawText = await response.text();
  let payload: any = null;

  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error(
      payload?.error ||
        rawText ||
        `Authentication request failed with status ${response.status}.`,
    ) as Error & { code?: string };
    if (payload?.code) {
      error.code = payload.code;
    }
    throw error;
  }

  return payload;
}

export async function fetchProfileFromApi(accessToken: string): Promise<User> {
  const payload = await parseApiResponse(
    await fetch("/api/auth/profile", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }),
  );

  return mapProfileToUser(payload.profile);
}

export async function signUpWithApproval(payload: SignUpPayload) {
  await parseApiResponse(
    await fetch("/api/auth/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
  );
}
