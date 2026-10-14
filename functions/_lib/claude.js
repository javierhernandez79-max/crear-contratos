// Llamada a la API de Claude con salida JSON según un esquema. La llave (ANTHROPIC_API_KEY) es un secreto
// de Cloudflare: nunca llega al navegador. Devuelve { out, uso } o { error, status } con un mensaje para el usuario.
export const MODELO = 'claude-sonnet-5-5';

export async function pedirJSON(env, { system, content, schema, maxTokens = 8000, effort = 'low', queLee = 'el documento' }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: maxTokens,
      system,
      output_config: { effort, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    }),
  });
  const res = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Claude API', r.status, JSON.stringify(res.error || res));
    const m = res.error?.message || '';
    const error = r.status === 429 || r.status === 529 ? 'La IA está saturada; intenta en un minuto.'
      : r.status === 413 || /too large|too many pages/i.test(m) ? `${queLee[0].toUpperCase()}${queLee.slice(1)} es demasiado grande para leerlo con IA.`
        : r.status === 401 || r.status === 403 ? 'La llave de la IA no es válida: revísala en Cloudflare.'
          : r.status === 402 || /credit|billing/i.test(m) ? 'La cuenta de la IA no tiene saldo.'
            : `La IA no pudo leer ${queLee}.`;
    return { error, status: 502 };
  }
  if (res.stop_reason === 'refusal') return { error: `La IA no quiso procesar ${queLee}.`, status: 422 };
  if (res.stop_reason === 'max_tokens') return { error: 'La respuesta de la IA quedó incompleta; intenta de nuevo.', status: 502 };
  const texto = (res.content || []).find((b) => b.type === 'text')?.text || '';
  try { return { out: JSON.parse(texto), uso: res.usage }; } catch { return { error: 'La IA devolvió una respuesta ilegible.', status: 502 }; }
}
