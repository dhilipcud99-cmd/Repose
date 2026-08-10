function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      ...extraHeaders,
    },
  });
}

function toDataUrl(payload, mimeType = 'image/png') {
  if (typeof payload === 'string') {
    return payload.startsWith('data:') ? payload : `data:${mimeType};base64,${payload}`;
  }

  const bytes = payload instanceof Uint8Array
    ? payload
    : new Uint8Array(payload);

  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed' }, 405);
  }

  try {
    const formData = await request.formData();
    const prompt = formData.get('prompt')?.toString()?.trim() || 'cinematic portrait, high detail, natural lighting';

    if (env?.AI && typeof env.AI.run === 'function') {
      try {
        const aiResult = await env.AI.run('@cf/black-forest-labs/flux-schnell', {
          prompt,
          size: '1024x1024',
        });

        const imageUrl = toDataUrl(aiResult?.image || aiResult, 'image/png');
        return jsonResponse({ imageUrl });
      } catch (aiError) {
        console.error('Cloudflare AI generation failed:', aiError);
      }
    }

    const upstreamUrl = env?.REPOSE_UPSTREAM_URL || 'https://repose-jlz4.onrender.com/api/generate-pose';
    const upstreamResponse = await fetch(upstreamUrl, {
      method: 'POST',
      body: formData,
      headers: {
        'x-forwarded-host': new URL(request.url).host,
        'x-forwarded-proto': new URL(request.url).protocol.replace(':', ''),
      },
    });

    const responseBody = await upstreamResponse.text();
    return new Response(responseBody, {
      status: upstreamResponse.status,
      headers: {
        'content-type': upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  } catch (error) {
    console.error('generate-pose request failed:', error);
    return jsonResponse(
      { message: error?.message || 'Image generation failed. Configure Cloudflare AI or an upstream backend URL.' },
      500,
    );
  }
}
