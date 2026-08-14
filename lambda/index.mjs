// Smart Home skills must use a Lambda endpoint, so this shim exists only to
// forward every directive to the Cloudflare Worker and relay the response.
const WORKER_URL = process.env.WORKER_URL;
const DIRECTIVE_SECRET = process.env.DIRECTIVE_SECRET;

export const handler = async (event) => {
  const res = await fetch(`${WORKER_URL}/alexa/directive`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-directive-secret': DIRECTIVE_SECRET,
    },
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    throw new Error(`Worker responded ${res.status}: ${await res.text()}`);
  }
  return res.json();
};
