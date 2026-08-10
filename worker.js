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

  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function callWorkersAI(prompt, env) {
  if (!env?.AI || typeof env.AI.run !== 'function') {
    throw new Error('Workers AI binding is not configured.');
  }

  const result = await env.AI.run('@cf/black-forest-labs/flux-schnell', {
    prompt,
    size: '1024x1024',
  });

  if (!result) {
    throw new Error('Cloudflare AI returned an empty result.');
  }

  if (typeof result === 'string') {
    return toDataUrl(result, 'image/png');
  }

  if (result.image) {
    return toDataUrl(result.image, 'image/png');
  }

  return toDataUrl(result, 'image/png');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

    if (url.pathname === '/api/generate-pose') {
      if (request.method !== 'POST') {
        return jsonResponse({ message: 'Method not allowed' }, 405);
      }

      const requestClone = request.clone();
      const formData = await requestClone.formData();
      const prompt = formData.get('prompt')?.toString()?.trim() || 'cinematic portrait, high detail, natural lighting';

      if (env?.AI && typeof env.AI.run === 'function') {
        try {
          const imageUrl = await callWorkersAI(prompt, env);
          return jsonResponse({ imageUrl });
        } catch (aiError) {
          console.error('Cloudflare AI generation failed:', aiError);
        }
      }

      const upstreamUrl = env.REPOSE_UPSTREAM_URL || 'https://repose-jlz4.onrender.com/api/generate-pose';
      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        body: request.body,
        headers: {
          'x-forwarded-host': url.host,
          'x-forwarded-proto': url.protocol.replace(':', ''),
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
    }

    return new Response('Repose Worker is running. Use POST /api/generate-pose.', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
