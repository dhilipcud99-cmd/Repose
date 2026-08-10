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

  if (payload instanceof ArrayBuffer) {
    return toDataUrl(new Uint8Array(payload), mimeType);
  }

  if (payload instanceof Uint8Array) {
    let binary = '';
    for (let i = 0; i < payload.byteLength; i += 1) {
      binary += String.fromCharCode(payload[i]);
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
  }

  if (payload instanceof Blob) {
    return payload.arrayBuffer().then((buf) => toDataUrl(new Uint8Array(buf), mimeType));
  }

  return null;
}

async function extractImageUrl(result) {
  if (!result) return null;
  if (typeof result === 'string') return result.startsWith('data:') ? result : `data:image/png;base64,${result}`;
  if (result.image && typeof result.image === 'string') return result.image;
  if (result.url && typeof result.url === 'string') return result.url;
  if (result.image_url && typeof result.image_url === 'string') return result.image_url;
  if (result.base64 && typeof result.base64 === 'string') return `data:image/png;base64,${result.base64}`;
  if (Array.isArray(result.images) && result.images.length > 0) {
    return extractImageUrl(result.images[0]);
  }
  if (Array.isArray(result.output) && result.output.length > 0) {
    for (const item of result.output) {
      const candidate = await extractImageUrl(item);
      if (candidate) return candidate;
    }
  }
  if (Array.isArray(result.data) && result.data.length > 0) {
    return extractImageUrl(result.data[0]);
  }
  if (result[0]) return extractImageUrl(result[0]);
  return null;
}

async function callWorkersAI(prompt, env) {
  if (!env?.AI || typeof env.AI.run !== 'function') {
    throw new Error('Workers AI binding is not configured. Add an AI binding named "AI" to this Worker.');
  }

  const modelId = env.AI_MODEL || '@cf/phoenix-1';
  const result = await env.AI.run(modelId, {
    prompt,
    size: '1024x1024',
  });

  const imageUrl = await extractImageUrl(result);
  if (!imageUrl) {
    throw new Error(`Cloudflare AI returned an unsupported result format for model ${modelId}.`);
  }

  return imageUrl;
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

      const formData = await request.formData();
      const prompt = formData.get('prompt')?.toString()?.trim() || 'cinematic portrait, high detail, natural lighting';

      if (env?.AI && typeof env.AI.run === 'function') {
        try {
          const imageUrl = await callWorkersAI(prompt, env);
          return jsonResponse({ imageUrl });
        } catch (aiError) {
          console.error('Cloudflare AI generation failed:', aiError);
          return jsonResponse({ message: `Cloudflare AI error: ${aiError.message}` }, 500);
        }
      }

      const upstreamUrl = env.REPOSE_UPSTREAM_URL;
      if (!upstreamUrl) {
        return jsonResponse({
          message: 'No Workers AI binding is configured and no upstream URL is set. Add an AI binding named "AI" or set a valid REPOSE_UPSTREAM_URL.',
        }, 500);
      }

      const upstreamResponse = await fetch(upstreamUrl, {
        method: 'POST',
        body: request.body,
        headers: {
          'x-forwarded-host': url.host,
          'x-forwarded-proto': url.protocol.replace(':', ''),
        },
      });

      const responseText = await upstreamResponse.text();
      if (!upstreamResponse.ok) {
        console.error('Upstream fallback error:', upstreamResponse.status, responseText);
        return jsonResponse({
          message: `Upstream fallback returned ${upstreamResponse.status}: ${responseText}`,
        }, upstreamResponse.status);
      }

      return new Response(responseText, {
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
