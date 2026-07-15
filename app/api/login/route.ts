import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { password } = await request.json();

  if (!process.env.APP_PASSWORD) {
    console.warn("[auth] APP_PASSWORD is not set in env vars — fallback login is disabled.");
    return NextResponse.json({ error: "Fallback login not configured" }, { status: 500 });
  }

  if (password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set("app_session", "valid", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
