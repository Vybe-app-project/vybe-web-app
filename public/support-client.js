const DEFAULT_TIMEOUT_MS = 15_000;

const normalizedApiBaseUrl = (documentRef) => {
  const configured = documentRef
    .querySelector('meta[name="vybe-api-base-url"]')
    ?.getAttribute('content')
    ?.trim();
  if (!configured) throw new Error('Support is not configured.');

  const pageOrigin = documentRef.defaultView?.location.origin;
  if (!pageOrigin) throw new Error('Support is not configured.');
  const parsed = new URL(configured, pageOrigin);
  const localHosts = ['127.0.0.1', 'localhost', '[::1]'];
  const localDevelopment = (
    parsed.protocol === 'http:'
    && localHosts.includes(parsed.hostname)
    && localHosts.includes(documentRef.defaultView?.location.hostname)
  );
  if (parsed.protocol !== 'https:' && !localDevelopment) {
    throw new Error('Support is not configured securely.');
  }
  return parsed.toString().replace(/\/+$/, '');
};

const responseBody = async (response) => {
  try {
    return await response.json();
  } catch {
    return {};
  }
};

export const createSupportFormController = ({
  documentRef = document,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const form = documentRef.getElementById('support-form');
  const submitButton = documentRef.getElementById('submit-button');
  const retryButton = documentRef.getElementById('retry-button');
  const status = documentRef.getElementById('support-status');
  const controls = [...form.querySelectorAll('input, textarea, button')];
  const endpoint = `${normalizedApiBaseUrl(documentRef)}/support/message`;
  let lastSubmission = null;
  let sending = false;

  const setBusy = (busy) => {
    sending = busy;
    form.setAttribute('aria-busy', String(busy));
    for (const control of controls) {
      control.disabled = busy;
    }
    submitButton.textContent = busy ? 'Sending…' : 'Send private request';
  };

  const setStatus = (state, message, canRetry = false) => {
    status.dataset.state = state;
    status.setAttribute('role', state === 'error' ? 'alert' : 'status');
    status.textContent = message;
    retryButton.hidden = !canRetry;
  };

  const send = async (payload) => {
    if (sending) return;
    setBusy(true);
    setStatus('loading', 'Sending your request securely…');

    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        credentials: 'omit',
        signal: controller.signal,
      });
      const body = await responseBody(response);
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Too many requests were sent. Wait a few minutes, then retry.');
        }
        throw new Error(
          response.status >= 500
            ? 'Vybe support is temporarily unavailable. Your message was not sent.'
            : body?.message || 'Check the form details and try again.',
        );
      }

      form.reset();
      lastSubmission = null;
      setStatus('success', 'Your request was sent to the private Vybe support inbox.');
    } catch (error) {
      const message = error?.name === 'AbortError'
        ? 'The request timed out. Check your connection and retry.'
        : error?.message || 'The request could not be sent. Check your connection and retry.';
      setStatus('error', message, true);
    } finally {
      globalThis.clearTimeout(timeout);
      setBusy(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    lastSubmission = {
      fullName: String(formData.get('fullName') || '').trim(),
      email: String(formData.get('email') || '').trim().toLowerCase(),
      message: String(formData.get('message') || '').trim(),
    };
    if (lastSubmission.fullName.length < 2 || lastSubmission.message.length < 10) {
      setStatus('error', 'Enter your full name and at least 10 characters describing the request.');
      return;
    }
    void send(lastSubmission);
  };

  const handleRetry = () => {
    if (lastSubmission) void send(lastSubmission);
  };

  form.addEventListener('submit', handleSubmit);
  retryButton.addEventListener('click', handleRetry);

  return {
    destroy() {
      lastSubmission = null;
      form.removeEventListener('submit', handleSubmit);
      retryButton.removeEventListener('click', handleRetry);
    },
  };
};
