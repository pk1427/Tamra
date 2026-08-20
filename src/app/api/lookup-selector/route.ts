import { NextResponse } from 'next/server';

const cache = new Map<string, string | null>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const selector = url.searchParams.get('selector');

  if (!selector || !/^0x[0-9a-f]{8}$/i.test(selector)) {
    return NextResponse.json({ error: 'Invalid selector' }, { status: 400 });
  }

  if (cache.has(selector)) {
    const result = cache.get(selector);
    return NextResponse.json({ signature: result });
  }

  try {
    const res = await fetch(`https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`);

    if (!res.ok) {
      cache.set(selector, null);
      return NextResponse.json({ signature: null });
    }

    const data = await res.json();
    const signature = data.results?.[0]?.text_signature ?? null;

    cache.set(selector, signature);
    return NextResponse.json({ signature });
  } catch {
    cache.set(selector, null);
    return NextResponse.json({ signature: null });
  }
}
