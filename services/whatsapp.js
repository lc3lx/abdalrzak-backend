const WHATSAPP_GRAPH_VERSION = "v19.0";

export function normalizeWhatsAppPhoneNumber(phoneNumber) {
  return String(phoneNumber || "").replace(/[^\d]/g, "");
}

export function getWhatsAppApiError(errorOrResult) {
  return (
    errorOrResult?.error?.message ||
    errorOrResult?.response?.data?.error?.message ||
    errorOrResult?.message ||
    "WhatsApp API request failed"
  );
}

export function buildWhatsAppMessagePayload({ to, content, imageUrl }) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: normalizeWhatsAppPhoneNumber(to),
  };

  if (imageUrl) {
    payload.type = "image";
    payload.image = {
      link: imageUrl,
      caption: content || undefined,
    };
  } else {
    payload.type = "text";
    payload.text = {
      preview_url: true,
      body: content,
    };
  }

  return payload;
}

export async function sendWhatsAppMessage({
  phoneNumberId,
  accessToken,
  to,
  content,
  imageUrl,
}) {
  if (!phoneNumberId || !accessToken) {
    throw new Error("WhatsApp account is not configured");
  }

  const normalizedTo = normalizeWhatsAppPhoneNumber(to);
  if (!normalizedTo) {
    throw new Error("Recipient WhatsApp phone number is required");
  }

  const payload = buildWhatsAppMessagePayload({
    to: normalizedTo,
    content,
    imageUrl,
  });

  const response = await fetch(
    `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const result = await response.json();
  if (!response.ok) {
    throw new Error(getWhatsAppApiError(result));
  }

  return {
    raw: result,
    messageId: result.messages?.[0]?.id,
    recipient: result.contacts?.[0]?.wa_id || normalizedTo,
  };
}
